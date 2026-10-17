// Spike: resolve a Flutter project's lib/ with package:analyzer, list Widget classes,
// classify constructor params by how hard they are to generate, find context deps.
// Usage: indexer <projectRoot> [dartSdkPath] [--json out.json]
import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/analysis_context_collection.dart';
import 'package:analyzer/dart/analysis/results.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';
import 'package:analyzer/dart/element/element.dart';
import 'package:analyzer/dart/element/nullability_suffix.dart';
import 'package:analyzer/dart/element/type.dart';
import 'package:analyzer/diagnostic/diagnostic.dart';
import 'package:analyzer/src/dart/analysis/analysis_context_collection.dart';
import 'package:analyzer/src/dart/analysis/file_byte_store.dart';
import 'package:path/path.dart' as p;

const frameworkUri = 'package:flutter/src/widgets/framework.dart';

bool isFrameworkWidget(Element e) => e.name == 'Widget' && e.library?.uri.toString() == frameworkUri;

bool isWidget(InterfaceElement e) => isFrameworkWidget(e) || e.allSupertypes.any((t) => isFrameworkWidget(t.element));

late String pkgPrefix;
final projectClasses = <ClassElement>[];

bool inProject(Element? e) => e?.library?.uri.toString().startsWith(pkgPrefix) ?? false;

const simpleNames = {
  'Color', 'IconData', 'DateTime', 'Duration', 'Offset', 'Size', 'EdgeInsets', 'EdgeInsetsGeometry', 'TextStyle',
  'BorderRadius', 'Alignment', 'AlignmentGeometry', 'Uri', 'Key', 'Locale', 'Radius', 'Rect',
};
const controllerNames = {
  'TextEditingController', 'ScrollController', 'AnimationController', 'TabController', 'PageController', 'FocusNode',
  'Animation',
};

/// Ranked from easy to impossible; a constructor takes the worst of its params.
const ranks = ['zero', 'simple', 'controller', 'model', 'fake', 'blocked'];

String worst(Iterable<String> cats) {
  var r = 0;
  for (final c in cats) {
    final i = ranks.indexOf(c);
    if (i > r) r = i;
  }
  return ranks[r];
}

final blockedWhy = <String, int>{};

String block(String why) {
  blockedWhy[why] = (blockedWhy[why] ?? 0) + 1;
  return 'blocked';
}

String classify(DartType t, int depth, Set<Element> seen) {
  if (t is DynamicType || t is InvalidType) return block('dynamic/invalid');
  if (t.nullabilitySuffix == NullabilitySuffix.question) return 'simple'; // pass null
  if (t is FunctionType) {
    final ret = t.returnType;
    if (ret is VoidType || ret.isDartCoreNull) return 'simple';
    return classify(ret, depth, seen);
  }
  if (t is TypeParameterType) return classify(t.bound, depth, seen);
  if (t is RecordType) return worst(t.positionalFields.map((f) => classify(f.type, depth, seen)).followedBy(t.namedFields.map((f) => classify(f.type, depth, seen))));
  if (t is! InterfaceType) return block('other-type:${t.runtimeType}');
  final e = t.element;
  final name = e.name ?? '';
  if (t.isDartCoreString || t.isDartCoreInt || t.isDartCoreDouble || t.isDartCoreNum || t.isDartCoreBool || t.isDartCoreObject) return 'simple';
  if (e is EnumElement) return 'simple';
  if (simpleNames.contains(name)) return 'simple';
  if (isWidget(e)) return 'simple'; // Placeholder
  if (t.isDartCoreList || t.isDartCoreSet || t.isDartCoreIterable || t.isDartCoreMap) {
    if (t.typeArguments.isEmpty) return 'simple';
    return worst(t.typeArguments.map((a) => classify(a, depth, seen)).followedBy(['simple']));
  }
  if (t.isDartAsyncFuture || t.isDartAsyncFutureOr || t.isDartAsyncStream) {
    return t.typeArguments.isEmpty ? 'simple' : classify(t.typeArguments.first, depth, seen);
  }
  if (controllerNames.contains(name)) return 'controller';
  if (name == 'BuildContext') return block('BuildContext');
  if (e is! ClassElement) return block('non-class:${e.runtimeType}');
  if (depth >= 3) return block('depth>3');
  if (!seen.add(e)) return block('cycle');
  try {
    final abstractLike = e.isAbstract || e.isSealed || e.isInterface && !inProject(e);
    if (e.isAbstract || e.isSealed) {
      final subs = projectClasses.where((c) => !c.isAbstract && !c.isSealed && c.allSupertypes.any((s) => s.element == e)).toList();
      if (subs.isNotEmpty) {
        final c = bestCtor(subs.first);
        if (c != null) return worst([ctorCategory(c, depth + 1, seen), 'model']);
      }
      // implements from the generated host library.
      if (e.isSealed || e.isFinal || e.isBase) return block('${e.isSealed ? 'sealed' : e.isFinal ? 'final' : 'base'} class (no implements outside its library)');
      if (abstractLike) return 'fake';
    }
    final c = bestCtor(e);
    if (c == null) return inProject(e) ? block('project class, no public ctor') : block('package class, no public ctor');
    return worst([ctorCategory(c, depth + 1, seen), 'model']);
  } finally {
    seen.remove(e);
  }
}

ConstructorElement? bestCtor(InterfaceElement e) {
  final pub = e.constructors.where((c) => c.isPublic).toList();
  if (pub.isEmpty) return null;
  int req(ConstructorElement c) => c.formalParameters.where((f) => f.isRequired).length;
  pub.sort((a, b) {
    final r = req(a).compareTo(req(b));
    if (r != 0) return r;
    return (a.name == 'new' ? 0 : 1).compareTo(b.name == 'new' ? 0 : 1);
  });
  return pub.first;
}

String ctorCategory(ConstructorElement c, int depth, Set<Element> seen) {
  final cats = <String>['zero'];
  for (final f in c.formalParameters) {
    if (!f.isRequired) continue;
    cats.add(classify(f.type, depth, seen));
  }
  return worst(cats);
}

/// Context dependencies read directly in a class body (and its State).
class DepVisitor extends RecursiveAstVisitor<void> {
  final _deps = <String>{};
  final children = <ClassElement>{};
  /// Inside a closure (onTap: () => context.push(...)): does not run on the first build.
  var _closure = 0;

  Set<String> get deps => _deps;

  _Tags get _tags => _Tags(_deps, _closure > 0);

  @override
  void visitFunctionExpression(FunctionExpression node) {
    // A local function / closure body, not the member's own body.
    final isMemberBody = node.parent is FunctionDeclaration && node.parent!.parent is CompilationUnit;
    if (!isMemberBody) _closure++;
    super.visitFunctionExpression(node);
    if (!isMemberBody) _closure--;
  }

  void _lib(Element? e, String tag) {
    final deps = _tags;
    final uri = e?.library?.uri.toString() ?? '';
    if (uri.startsWith('package:get_it/')) deps.add('get_it');
    if (uri.startsWith('package:provider/')) deps.add('provider:$tag');
    if (uri.startsWith('package:flutter_bloc/') || uri.startsWith('package:bloc/')) deps.add('bloc:$tag');
    if (uri.startsWith('package:flutter_riverpod/') || uri.startsWith('package:riverpod/') || uri.startsWith('package:hooks_riverpod/')) deps.add('riverpod:$tag');
    if (uri.startsWith('package:go_router/')) deps.add('go_router:$tag');
    if (uri.startsWith('package:easy_localization/')) deps.add('easy_localization');
  }

  @override
  void visitMethodInvocation(MethodInvocation node) {
    final el = node.methodName.element;
    final name = node.methodName.name;
    final deps = _tags;
    if (name == 'of' || name == 'maybeOf') {
      final target = node.target;
      if (target is SimpleIdentifier && target.element is InterfaceElement) {
        final t = target.element as InterfaceElement;
        deps.add(inProject(t) ? 'of:project:${t.name}' : 'of:${t.name}');
      }
    }
    _lib(el, name);
    super.visitMethodInvocation(node);
  }

  @override
  void visitInstanceCreationExpression(InstanceCreationExpression node) {
    final e = node.constructorName.type.element;
    if (e is ClassElement && inProject(e) && isWidget(e)) children.add(e);
    _lib(e, e?.name ?? '?');
    super.visitInstanceCreationExpression(node);
  }

  @override
  void visitSimpleIdentifier(SimpleIdentifier node) {
    final e = node.element;
    if (e != null && (e.library?.uri.toString() ?? '').startsWith('package:get_it/')) _tags.add('get_it');
    super.visitSimpleIdentifier(node);
  }

  @override
  void visitFunctionExpressionInvocation(FunctionExpressionInvocation node) {
    final t = node.function.staticType;
    if (t is InterfaceType) _lib(t.element, 'call');
    super.visitFunctionExpressionInvocation(node);
  }
}

class _Tags {
  _Tags(this.set, this.lazy);
  final Set<String> set;
  final bool lazy;
  void add(String tag) => set.add(lazy ? 'lazy:$tag' : tag);
}

Future<void> main(List<String> args) async {
  final jsonAt = args.indexOf('--json');
  final jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
  final pos = [for (var i = 0; i < args.length; i++) if (!args[i].startsWith('--') && (i == 0 || (args[i - 1] != '--json' && args[i - 1] != '--cache'))) args[i]];
  final root = p.normalize(p.absolute(pos[0]));
  final sdk = pos.length > 1 ? p.normalize(p.absolute(pos[1])) : null;
  final pubspec = File(p.join(root, 'pubspec.yaml')).readAsStringSync();
  final pkg = RegExp(r'^name:\s*(\S+)', multiLine: true).firstMatch(pubspec)!.group(1)!;
  pkgPrefix = 'package:$pkg/';

  final sw = Stopwatch()..start();
  final lib = p.join(root, 'lib');
  final cacheAt = args.indexOf('--cache');
  final collection = cacheAt >= 0
      ? AnalysisContextCollectionImpl(includedPaths: [lib], sdkPath: sdk, byteStore: EvictingFileByteStore(p.normalize(p.absolute(args[cacheAt + 1])), 512 * 1024 * 1024))
      : AnalysisContextCollection(includedPaths: [lib], sdkPath: sdk);
  final tCreate = sw.elapsedMilliseconds;
  // analysis_options.yaml `exclude:` applies: those files have no context.
  final files = [for (final c in collection.contexts) ...c.contextRoot.analyzedFiles().where((f) => f.endsWith('.dart') && p.isWithin(lib, f))]..sort();

  final libs = <ResolvedLibraryResult>[];
  var parts = 0;
  final errorCodes = <String, int>{};
  var errorCount = 0;
  final elementsOnly = args.contains('--elements');
  final libElements = <LibraryElement>{};
  var tFirst = -1;
  for (final file in files) {
    final session = collection.contextFor(file).currentSession;
    if (elementsOnly) {
      // Declarations only (no bodies): enough for classes, supertypes, constructors, parameter types.
      final r = await session.getUnitElement(file);
      if (r is UnitElementResult) libElements.add(r.fragment.element);
      if (tFirst < 0) tFirst = sw.elapsedMilliseconds - tCreate;
      continue;
    }
    final res = await session.getResolvedLibrary(file);
    if (tFirst < 0) tFirst = sw.elapsedMilliseconds - tCreate;
    if (res is! ResolvedLibraryResult) {
      parts++;
      continue;
    }
    libs.add(res);
    libElements.add(res.element);
    for (final u in res.units) {
      for (final d in u.diagnostics) {
        if (d.severity != Severity.error) continue;
        errorCount++;
        final code = d.diagnosticCode.name;
        errorCodes[code] = (errorCodes[code] ?? 0) + 1;
      }
    }
  }
  final tResolve = sw.elapsedMilliseconds - tCreate;

  for (final l in libElements) {
    projectClasses.addAll(l.classes);
  }

  // AST of each class, for deps.
  final declOf = <ClassElement, ClassDeclaration>{};
  for (final l in libs) {
    for (final u in l.units) {
      for (final d in u.unit.declarations.whereType<ClassDeclaration>()) {
        final e = d.declaredFragment?.element;
        if (e != null) declOf[e] = d;
      }
    }
  }

  final widgets = projectClasses.where(isWidget).toList();
  final rows = <Map<String, Object?>>[];
  final directDeps = <ClassElement, Set<String>>{};
  final childrenOf = <ClassElement, Set<ClassElement>>{};
  for (final w in widgets) {
    final v = DepVisitor();
    declOf[w]?.accept(v);
    // The State<W> of a StatefulWidget.
    for (final s in projectClasses) {
      final st = s.allSupertypes.where((t) => t.element.name == 'State' && t.element.library.uri.toString() == frameworkUri);
      if (st.isNotEmpty && st.first.typeArguments.isNotEmpty && st.first.typeArguments.first.element == w) declOf[s]?.accept(v);
    }
    if (w.allSupertypes.any((t) => (t.element.library.uri.toString()).contains('riverpod'))) v.deps.add('riverpod:ConsumerWidget');
    if (w.allSupertypes.any((t) => (t.element.library.uri.toString()).contains('flutter_hooks'))) v.deps.add('hooks');
    directDeps[w] = v.deps;
    childrenOf[w] = v.children;
  }
  Set<String> closure(ClassElement w, Set<ClassElement> seen) {
    if (!seen.add(w)) return {};
    final out = {...?directDeps[w]};
    for (final c in childrenOf[w] ?? const <ClassElement>{}) out.addAll(closure(c, seen));
    return out;
  }

  bool needsScope(String d) => !d.startsWith('of:') || d.startsWith('of:project:');
  final cats = <String, int>{};
  var withDirect = 0, withTransitiveOnly = 0, getIt = 0;
  for (final w in widgets) {
    String cat;
    if (w.isAbstract || w.isSealed) {
      cat = 'abstract';
    } else if (w.isPrivate) {
      cat = 'private';
    } else {
      final c = bestCtor(w);
      cat = c == null ? 'no-public-ctor' : ctorCategory(c, 0, {});
    }
    cats[cat] = (cats[cat] ?? 0) + 1;
    final direct = directDeps[w]!.where(needsScope).toSet();
    final all = closure(w, {}).where(needsScope).toSet();
    if (direct.isNotEmpty) withDirect++;
    if (direct.isEmpty && all.isNotEmpty) withTransitiveOnly++;
    if (all.contains('get_it')) getIt++;
    final frag = w.firstFragment;
    rows.add({
      'name': w.name,
      'file': p.relative(frag.libraryFragment.source.fullName, from: root).replaceAll('\\', '/'),
      'line': frag.libraryFragment.lineInfo.getLocation(frag.nameOffset ?? 0).lineNumber,
      'cat': cat,
      'mods': [if (w.isAbstract) 'abstract', if (w.isSealed) 'sealed', if (w.isBase) 'base', if (w.isFinal) 'final', if (w.isInterface) 'interface'],
      'direct': direct.toList()..sort(),
      'transitive': all.difference(direct).toList()..sort(),
    });
  }
  final tIndex = sw.elapsedMilliseconds - tCreate - tResolve;

  // Incremental: re-resolve one widget file after changeFile (content unchanged on disk).
  var tIncr = -1;
  if (widgets.isNotEmpty) {
    final f = widgets.first.firstFragment.libraryFragment.source.fullName;
    final ctx = collection.contextFor(f);
    final s2 = Stopwatch()..start();
    ctx.changeFile(f);
    await ctx.applyPendingFileChanges();
    await ctx.currentSession.getResolvedLibrary(f);
    tIncr = s2.elapsedMilliseconds;
  }

  final summary = {
    'project': p.basename(root),
    'files': files.length,
    'libraries': libs.length,
    'parts': parts,
    'errors': errorCount,
    'errorCodes': errorCodes,
    'widgets': widgets.length,
    'categories': cats,
    'blockedWhy': blockedWhy,
    'depsDirect': withDirect,
    'depsTransitiveOnly': withTransitiveOnly,
    'usesGetIt': getIt,
    'mode': elementsOnly ? 'elements' : 'resolved',
    'ms': {'create': tCreate, 'firstLibrary': tFirst, 'resolveAll': tResolve, 'index': tIndex, 'incremental': tIncr},
    'maxRssMB': (ProcessInfo.maxRss / 1024 / 1024).round(),
  };
  stdout.writeln(const JsonEncoder.withIndent('  ').convert(summary));
  if (jsonOut != null) File(jsonOut).writeAsStringSync(const JsonEncoder.withIndent('  ').convert({'summary': summary, 'widgets': rows}));
}
