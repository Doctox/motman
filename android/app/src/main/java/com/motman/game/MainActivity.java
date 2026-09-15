package com.motman.game;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /*
         * Mode tablette (src/tabletViewport.ts) : en portrait, la page annonce
         * "width=640" et la WebView l'agrandit pour remplir l'écran. Sans ces
         * deux réglages, la WebView ignore la largeur annoncée. Sur téléphone
         * la page reste en "width=device-width" : rien ne change.
         */
        getBridge().getWebView().getSettings().setUseWideViewPort(true);
        getBridge().getWebView().getSettings().setLoadWithOverviewMode(true);

        /*
         * Android 15+ draws applications behind the status and navigation bars.
         * Shrink the interactive WebView viewport so MotMan controls never sit
         * below the system UI, with gesture and three-button navigation alike.
         */
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets safeInsets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() |
                WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(
                safeInsets.left,
                safeInsets.top,
                safeInsets.right,
                safeInsets.bottom
            );
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
    }
}
