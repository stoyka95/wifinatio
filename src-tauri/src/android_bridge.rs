//! Calls into `cz.semakod.wifinatio.NetBridge` (Kotlin, see gen/android) over JNI.
//! Every bridge method takes the Android `Context` and returns a JSON string, so
//! the Rust side only deals with strings and serde.

use jni::objects::{JClass, JObject, JString, JValue};
use jni::{JNIEnv, JavaVM};
use serde::de::DeserializeOwned;

use crate::error::{AppError, AppResult};

const BRIDGE_CLASS: &str = "cz.semakod.wifinatio.NetBridge";

fn jni_err(e: jni::errors::Error) -> AppError {
    AppError::msg(format!("jni: {e}"))
}

/// Runs `f` with an attached JNI env, the bridge class and the app context.
/// Worker threads stay attached; a local frame frees the references after each call.
fn with_bridge<T>(f: impl FnOnce(&mut JNIEnv, &JClass, &JObject) -> jni::errors::Result<T>) -> AppResult<T> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(jni_err)?;
    let mut env = vm.attach_current_thread_permanently().map_err(jni_err)?;
    let result = env.with_local_frame(32, |env| {
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };
        // FindClass on a native thread only sees system classes, so go through the app's loader.
        let loader = env.call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
        let name = env.new_string(BRIDGE_CLASS)?;
        let class = env
            .call_method(&loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;", &[JValue::Object(&name)])?
            .l()?;
        f(env, &JClass::from(class), &context)
    });
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
    }
    result.map_err(jni_err)
}

/// Calls `NetBridge.<method>(Context): String`.
pub fn call_string(method: &str) -> AppResult<String> {
    with_bridge(|env, class, context| {
        let value = env
            .call_static_method(class, method, "(Landroid/content/Context;)Ljava/lang/String;", &[JValue::Object(context)])?
            .l()?;
        let text: String = env.get_string(&JString::from(value))?.into();
        Ok(text)
    })
}

/// Calls `NetBridge.<method>(Context, String): String`.
pub fn call_string_arg(method: &str, arg: &str) -> AppResult<String> {
    with_bridge(|env, class, context| {
        let arg = env.new_string(arg)?;
        let value = env
            .call_static_method(
                class,
                method,
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(context), JValue::Object(&arg)],
            )?
            .l()?;
        let text: String = env.get_string(&JString::from(value))?.into();
        Ok(text)
    })
}

/// Calls a bridge method and parses its JSON answer.
pub fn call_json<T: DeserializeOwned>(method: &str) -> AppResult<T> {
    Ok(serde_json::from_str(&call_string(method)?)?)
}
