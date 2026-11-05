package com.godoor.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Content bleeds into the notch and cut-out area on ANY device
        // (camera punch-hole, dynamic island, corner cut-outs) — the web
        // app already pads for it via the safe-area CSS classes.
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setDecorFitsSystemWindows(false);

        // On Android 15+ (API 35), edge-to-edge is the only option —
        // deprecations below are compile-time only and the system handles them.
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        // NOTE: previously this reset v.setPadding(0,0,0,0) on every inset,
        // which blocked inset dispatch to the WebView and broke
        // env(safe-area-inset-*) on some pages. Removed — insets now reach
        // the WebView and the web safe-area CSS does the padding.
    }
}
