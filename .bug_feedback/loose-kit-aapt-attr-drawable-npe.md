---
date: 2026-10-15
project: GolAIm / apps/layout-daemon (loose kit, ProjectCallback)
status: fixed
---

# Layout Preview: CheckBox / MaterialCheckBox / MaterialSwitch hiện placeholder (NPE khi đọc drawable)

## Triệu chứng
Render layout qua loose kit (hoặc project thật) với theme Material3: `CheckBox` (Material inflater → `MaterialCheckBox`), `MaterialCheckBox`, `MaterialSwitch` chỉ ra placeholder. Diagnostics:
```
Failed to parse file …/material-1.12.0/res/drawable/mtrl_checkbox_button_checked_unchecked.xml — NullPointerException: Cannot invoke "org.xmlpull.v1.XmlPullParser.getDepth()" because "parser" is null
com.google.android.material.checkbox.MaterialCheckBox failed to render: NotFoundException: Could not find drawable resource matching value 0x7F070094 (resolved name: mtrl_checkbox_button_checked_unchecked)
Failed to parse file …/mtrl_switch_thumb.xml — XmlPullParserException: <transition> tag requires a 'drawable' attribute or child tag defining a drawable
```

## Nguyên nhân
Res trong AAR là source chưa qua aapt2, nên `<aapt:attr name="android:animation">` (animator inline trong `animated-vector`) không được tách thành resource riêng. Parser của Paparazzi (`LayoutPullParser`) thay mỗi khối bằng giá trị `@aapt:_aapt/<id>` và giữ subtree trong `getAaptDeclaredAttrs()`; layoutlib sau đó gọi `LayoutlibCallback.getParser(value)` với `ResourceType.AAPT`. `ProjectCallback.getParser` của daemon trả `null` cho AAPT (và không thu thập aapt attrs) → layoutlib NPE `parser.getDepth()`. `PaparazziCallback` (chế độ framework-only) có xử lý, callback riêng của project/kit thì thiếu. Không phải lỗi R id hay giới hạn layoutlib.

## Solution
- `PaparazziInternals.parserFromFile(file, aaptOut)` đổ `getAaptDeclaredAttrs()` vào map; `parserFromAapt(tag, aaptOut)` = `LayoutPullParser.createFromAaptResource`.
- `ProjectCallback.getParser`: AAPT → tra map `aaptDeclared` (LRU 4096, vì mỗi lần parse sinh id mới từ counter toàn cục của Paparazzi); file → parse + thu thập.
- Test `LooseKitTest` "checkable Material widgets" (CheckBox/MaterialCheckBox checked+unchecked, RadioButton, MaterialSwitch, SwitchMaterial, Chip checkable, MaterialButtonToggleGroup, Slider; light + night; PNG ra `build/loose-kit-out/`); E2E `loose-kit.cjs` thêm CheckBox.

## Context
Paparazzi 2.0.0-alpha05.1, layoutlib 16.2.3, Material 1.12.0. Bài học: khi thay `PaparazziCallback` bằng callback riêng, phải port đủ hành vi của nó (đây là nhánh AAPT). Còn hở: `<aapt:attr>` nằm ngay trong buffer đang sửa (LayoutParser/KXmlParser không hỗ trợ).
