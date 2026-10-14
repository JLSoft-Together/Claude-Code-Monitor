package dev.ccm.fixture;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;

/** Fixture custom view calling device-only code in its constructor. */
public class CrashingView extends View {
    public CrashingView(Context context, AttributeSet attrs) {
        super(context, attrs);
        throw new IllegalStateException("needs a real device");
    }
}
