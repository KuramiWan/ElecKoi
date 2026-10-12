package com.eleckoi.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.view.View;
import android.view.animation.LinearInterpolator;

/** Native loading decoration; readiness remains owned by the Client admission signal. */
final class StartupMascotView extends View {
    private static final int SOURCE_WIDTH = 1080, SOURCE_HEIGHT = 580;
    private static final long LOOP_MS = 4400;
    private final Bitmap mascot;
    private final Paint imagePaint = new Paint();
    private final Paint lidPaint = new Paint();
    private final Rect source = new Rect(230, 310, 1310, 890);
    private final RectF target = new RectF(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT);
    private final Path leftLid = eyelid(356, 395, 120, 102, .525f, .85f);
    private final Path rightLid = eyelid(627, 395, 119, 102, .16f, .496f);
    private ValueAnimator idle;
    private boolean loading, active;
    private float offset, blink;

    StartupMascotView(Context context) {
        super(context);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inScaled = false;
        mascot = BitmapFactory.decodeResource(getResources(), R.drawable.whale_girl_pixel_dango, options);
        if (mascot == null || mascot.getWidth() != 1536 || mascot.getHeight() != 1024)
            throw new IllegalStateException("Startup mascot resource has invalid dimensions");
        imagePaint.setFilterBitmap(false);
        lidPaint.setColor(Color.rgb(254, 242, 235));
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    void showLoading() {
        loading = true;
        updateAnimation();
    }

    void stopLoading() {
        loading = false;
        stopAnimation();
    }

    void setActive(boolean value) {
        active = value;
        updateAnimation();
    }

    boolean canAnimate() {
        return active && isShown() && getWindowVisibility() == VISIBLE && ValueAnimator.areAnimatorsEnabled();
    }

    private void updateAnimation() {
        if (!loading || !isAttachedToWindow() || !canAnimate()) {
            stopAnimation();
            return;
        }
        if (idle != null) return;
        idle = ValueAnimator.ofFloat(0f, LOOP_MS);
        idle.setDuration(LOOP_MS);
        idle.setInterpolator(new LinearInterpolator());
        idle.setRepeatCount(ValueAnimator.INFINITE);
        idle.addUpdateListener(animation -> {
            float time = (float) animation.getAnimatedValue();
            offset = Math.round(-3f * getResources().getDisplayMetrics().density
                    * (float) Math.sin(time * Math.PI * 4 / LOOP_MS));
            blink = Math.max(blinkAt(time, 1450), blinkAt(time, 3450));
            invalidate();
        });
        idle.start();
    }

    private void stopAnimation() {
        if (idle != null) {
            idle.removeAllUpdateListeners();
            idle.cancel();
            idle = null;
        }
        offset = blink = 0f;
        invalidate();
    }

    private static float blinkAt(float time, float start) {
        float elapsed = time - start;
        if (elapsed < 0 || elapsed >= 230) return 0;
        if (elapsed < 70) return elapsed / 70;
        if (elapsed < 110) return 1;
        return 1 - (elapsed - 110) / 120;
    }

    private static Path eyelid(float x, float y, float width, float height, float lowerLeft, float lowerRight) {
        Path path = new Path();
        path.moveTo(x, y); path.lineTo(x + width, y);
        path.lineTo(x + width, y + height * .784f);
        path.lineTo(x + width * lowerRight, y + height * .784f);
        path.lineTo(x + width * lowerRight, y + height);
        path.lineTo(x + width * lowerLeft, y + height);
        path.lineTo(x + width * lowerLeft, y + height * .784f);
        path.lineTo(x, y + height * .784f); path.close();
        return path;
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        // Fit the approved opaque artwork, excluding its transparent canvas padding.
        float scale = Math.min(getWidth() / (float) SOURCE_WIDTH, getHeight() / (float) SOURCE_HEIGHT);
        canvas.save();
        canvas.translate((getWidth() - SOURCE_WIDTH * scale) / 2,
                (getHeight() - SOURCE_HEIGHT * scale) / 2 + offset);
        canvas.scale(scale, scale);
        canvas.drawBitmap(mascot, source, target, imagePaint);
        if (blink > 0) {
            canvas.save();
            canvas.scale(1, blink, 0, 395);
            canvas.drawPath(leftLid, lidPaint); canvas.drawPath(rightLid, lidPaint);
            canvas.restore();
        }
        canvas.restore();
    }

    @Override protected void onAttachedToWindow() { super.onAttachedToWindow(); updateAnimation(); }
    @Override protected void onDetachedFromWindow() { stopAnimation(); super.onDetachedFromWindow(); }
    @Override protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility); updateAnimation();
    }
    @Override protected void onVisibilityChanged(View changedView, int visibility) {
        super.onVisibilityChanged(changedView, visibility); updateAnimation();
    }
}
