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
         * Le plancher de police du WebView, lui, doit sauter.
         *
         * Android impose une taille minimale de 8 px CSS à tout texte d'un
         * WebView (WebSettings, défaut 8) -- Chrome, lui, n'en impose aucune.
         * C'est TOUTE la différence entre « ça marche dans Chrome » et « c'est
         * coupé dans l'app », traquée deux jours durant le 17/09/2026 et
         * mesurée par le pont de débogage : taille posée 5 px, taille rendue
         * 16 px (plancher 8, puis x2 pour la police système agrandie).
         *
         * L'ajustement des définitions (src/game/clueAutoFit.ts) a besoin de
         * descendre sous 8 px CSS quand le joueur a agrandi la police de son
         * téléphone : sinon le texte reste deux fois trop gros pour sa case et
         * se coupe en plein mot. C'est lui qui garantit la lisibilité, avec son
         * propre plancher mesuré en pixels AFFICHÉS.
         */
        getBridge().getWebView().getSettings().setMinimumFontSize(1);

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
