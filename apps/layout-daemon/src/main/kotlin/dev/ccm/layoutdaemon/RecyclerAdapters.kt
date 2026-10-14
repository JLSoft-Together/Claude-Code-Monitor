package dev.ccm.layoutdaemon

import android.R as AndroidR
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import net.bytebuddy.ByteBuddy
import net.bytebuddy.description.modifier.Visibility
import net.bytebuddy.dynamic.loading.ClassLoadingStrategy
import net.bytebuddy.dynamic.scaffold.subclass.ConstructorStrategy
import net.bytebuddy.implementation.FieldAccessor
import net.bytebuddy.implementation.MethodCall
import net.bytebuddy.implementation.MethodDelegation
import net.bytebuddy.implementation.bind.annotation.Argument
import net.bytebuddy.implementation.bind.annotation.FieldValue
import net.bytebuddy.implementation.bind.annotation.RuntimeType
import net.bytebuddy.implementation.bind.annotation.This
import net.bytebuddy.description.method.MethodDescription
import net.bytebuddy.matcher.ElementMatchers.named
import net.bytebuddy.matcher.ElementMatchers.takesArguments
import java.lang.reflect.Constructor
import java.util.Collections
import java.util.WeakHashMap

/**
 * `tools:listitem` / `tools:itemCount` for RecyclerView. layoutlib asks the callback for a
 * `RecyclerView.Adapter` with `setLayoutId` / `setItemCount`; Android Studio ships that class compiled
 * against RecyclerView, we generate it per project loader (RecyclerView only exists there).
 */
object RecyclerAdapters {
    private const val DEFAULT_COUNT = 10
    private val generated = Collections.synchronizedMap(WeakHashMap<Class<*>, Class<*>>())
    private val holders = Collections.synchronizedMap(WeakHashMap<Class<*>, Constructor<*>>())

    fun create(adapterBase: Class<*>): Any {
        val cls = generated.getOrPut(adapterBase) { generate(adapterBase) }
        return cls.getConstructor().newInstance()
    }

    private fun generate(adapterBase: Class<*>): Class<*> {
        val holderBase = Class.forName(adapterBase.name.removeSuffix("\$Adapter") + "\$ViewHolder", false, adapterBase.classLoader)
        val holder = ByteBuddy()
            .subclass(holderBase, ConstructorStrategy.Default.IMITATE_SUPER_CLASS_PUBLIC)
            .name("dev.ccm.generated.PreviewViewHolder")
            .make()
            .load(adapterBase.classLoader, ClassLoadingStrategy.Default.WRAPPER)
            .loaded
        val adapter = ByteBuddy()
            .subclass(adapterBase, ConstructorStrategy.Default.NO_CONSTRUCTORS)
            .name("dev.ccm.generated.PreviewAdapter")
            .defineField("layoutId", Int::class.javaPrimitiveType!!, Visibility.PUBLIC)
            .defineField("itemCount", Int::class.javaPrimitiveType!!, Visibility.PUBLIC)
            .defineConstructor(Visibility.PUBLIC)
            .intercept(MethodCall.invoke(adapterBase.getDeclaredConstructor()).andThen(FieldAccessor.ofField("itemCount").setsValue(DEFAULT_COUNT)))
            .defineMethod("setLayoutId", Void.TYPE, Visibility.PUBLIC).withParameters(Int::class.javaPrimitiveType)
            .intercept(FieldAccessor.ofField("layoutId"))
            .defineMethod("setItemCount", Void.TYPE, Visibility.PUBLIC).withParameters(Int::class.javaPrimitiveType)
            .intercept(FieldAccessor.ofField("itemCount"))
            .method(named("getItemCount")).intercept(FieldAccessor.ofField("itemCount"))
            .method(named("onCreateViewHolder")).intercept(MethodDelegation.to(Logic::class.java))
            .method(named<MethodDescription>("onBindViewHolder").and(takesArguments(2)))
            .intercept(MethodDelegation.to(Logic::class.java))
            .make()
            .load(holder.classLoader, ClassLoadingStrategy.Default.WRAPPER)
            .loaded
        holders[adapter] = holder.getConstructor(View::class.java)
        return adapter
    }

    object Logic {
        @JvmStatic
        @RuntimeType
        fun onCreateViewHolder(@This self: Any, @Argument(0) parent: ViewGroup, @FieldValue("layoutId") layoutId: Int): Any {
            val inflater = LayoutInflater.from(parent.context)
            val view = if (layoutId != 0) {
                inflater.inflate(layoutId, parent, false)
            } else {
                inflater.inflate(AndroidR.layout.simple_list_item_1, parent, false)
            }
            return holders.getValue(self.javaClass).newInstance(view)
        }

        @JvmStatic
        fun onBindViewHolder(@Argument(0) holder: Any, @Argument(1) position: Int, @FieldValue("layoutId") layoutId: Int) {
            if (layoutId != 0) return
            val itemView = runCatching { holder.javaClass.getField("itemView").get(holder) }.getOrNull()
            (itemView as? TextView)?.text = "Item $position"
        }
    }
}
