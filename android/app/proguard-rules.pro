# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Des traces lisibles dans Crashlytics : le fichier de correspondance part avec l'AAB.
-keepattributes SourceFile,LineNumberTable

# LA MISE A JOUR EMBARQUEE. Le module ecrit ces regles dans son propre fichier, mais il ne
# les transmet pas a l'application (pas de consumerProguardFiles) : sans cette copie, R8
# renommerait ce qu'il atteint par reflexion. Recopie de
# node_modules/@capgo/capacitor-updater/android/proguard-rules.pro, a relire a chaque
# montee de version du module.
-keepattributes *Annotation*, Signature
-keep class ee.forgr.capacitor_updater.** { *; }
-keep class com.getcapacitor.Bridge {
    com.getcapacitor.MessageHandler msgHandler;
}
-keep class com.getcapacitor.MessageHandler { *; }
-keep class com.getcapacitor.PluginCall {
    <init>(com.getcapacitor.MessageHandler, java.lang.String, java.lang.String, java.lang.String, com.getcapacitor.JSObject);
}
-keep class * implements com.getcapacitor.PluginHandle {
    public void invoke(java.lang.String, com.getcapacitor.PluginCall);
}
