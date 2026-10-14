package dev.ccm.fixture;

import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.View;

/** Fixture custom view: fills itself with app:badgeColor, read through R.styleable like AndroidX views do. */
public class BadgeView extends View {
    private final Paint paint = new Paint();

    public BadgeView(Context context, AttributeSet attrs) {
        super(context, attrs);
        TypedArray a = context.obtainStyledAttributes(attrs, R.styleable.BadgeView);
        paint.setColor(a.getColor(R.styleable.BadgeView_badgeColor, 0xFF000000));
        a.recycle();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        canvas.drawRect(0, 0, getWidth(), getHeight(), paint);
    }
}
