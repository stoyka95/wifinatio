# NetBridge is only called from Rust over JNI, so R8 cannot see its uses.
-keep class cz.semakod.wifinatio.NetBridge { *; }
-keep class cz.semakod.wifinatio.MainActivity { *; }
