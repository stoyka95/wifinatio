package cz.semakod.wifinatio

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.wifi.ScanResult
import android.net.wifi.SupplicantState
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Environment
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/**
 * Read-only access to Wi-Fi and network state for the Rust backend.
 * Called over JNI (src-tauri/src/android_bridge.rs); every method takes the
 * Context and returns JSON text, so the native side never touches Java objects.
 */
@Suppress("DEPRECATION")
object NetBridge {
  private const val PREFS = "wifinatio.bridge"
  private const val ASKED_LOCATION = "askedLocation"

  private fun wifi(ctx: Context) = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
  private fun connectivity(ctx: Context) = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  private fun hasPermission(ctx: Context): Boolean =
    ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun locationOn(ctx: Context): Boolean {
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    return if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled
    else Settings.Secure.getInt(ctx.contentResolver, Settings.Secure.LOCATION_MODE, 0) != 0
  }

  /** The Wi-Fi network, even when mobile data carries the default route. */
  private fun wifiNetwork(cm: ConnectivityManager): Network? =
    cm.allNetworks.firstOrNull { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }

  @JvmStatic
  fun hasLocation(ctx: Context): String = (hasPermission(ctx) && locationOn(ctx)).toString()

  @JvmStatic
  fun wifiStatus(ctx: Context): String {
    val wm = wifi(ctx)
    val cm = connectivity(ctx)
    val info: WifiInfo? = wm.connectionInfo
    val connected = wifiNetwork(cm) != null
    val handshaking = info?.supplicantState in setOf(
      SupplicantState.ASSOCIATING, SupplicantState.ASSOCIATED, SupplicantState.AUTHENTICATING,
      SupplicantState.FOUR_WAY_HANDSHAKE, SupplicantState.GROUP_HANDSHAKE,
    )
    val o = JSONObject()
      .put("wifiEnabled", wm.isWifiEnabled)
      .put("hasPermission", hasPermission(ctx))
      .put("locationOn", locationOn(ctx))
      .put("connected", connected)
      .put("connecting", !connected && handshaking)
      .put("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
    if (connected && info != null) {
      val ssid = info.ssid?.removeSurrounding("\"")
      // Android reports "<unknown ssid>" when the name is withheld (no location permission).
      o.put("ssid", ssid?.takeIf { it != "<unknown ssid>" })
      o.put("bssid", info.bssid)
      o.put("rssi", info.rssi)
      o.put("linkMbps", info.linkSpeed)
      if (Build.VERSION.SDK_INT >= 29) {
        o.put("txMbps", info.txLinkSpeedMbps)
        o.put("rxMbps", info.rxLinkSpeedMbps)
      }
      o.put("frequency", info.frequency)
      if (Build.VERSION.SDK_INT >= 30) o.put("standard", standardName(info.wifiStandard, info.frequency))
      if (Build.VERSION.SDK_INT >= 31) o.put("security", securityName(info.currentSecurityType))
    }
    return o.toString()
  }

  @JvmStatic
  fun scanResults(ctx: Context): String {
    val now = System.currentTimeMillis()
    val sinceBoot = SystemClock.elapsedRealtime()
    val arr = JSONArray()
    for (r in wifi(ctx).scanResults ?: emptyList<ScanResult>()) {
      val o = JSONObject()
        .put("ssid", r.SSID ?: "")
        .put("bssid", r.BSSID ?: "")
        .put("level", r.level)
        .put("frequency", r.frequency)
        .put("capabilities", r.capabilities ?: "")
        .put("lastSeen", now - (sinceBoot - r.timestamp / 1000))
      if (Build.VERSION.SDK_INT >= 23) {
        o.put("channelWidth", r.channelWidth)
        o.put("centerFreq0", r.centerFreq0)
      }
      if (Build.VERSION.SDK_INT >= 30) {
        o.put("standard", standardName(r.wifiStandard, r.frequency))
        o.put("ies", informationElements(r))
      }
      arr.put(o)
    }
    return arr.toString()
  }

  @JvmStatic
  fun startScan(ctx: Context): String = wifi(ctx).startScan().toString()

  @JvmStatic
  fun linkInfo(ctx: Context): String {
    val cm = connectivity(ctx)
    val network = wifiNetwork(cm) ?: cm.activeNetwork ?: return JSONObject().toString()
    val lp: LinkProperties = cm.getLinkProperties(network) ?: return JSONObject().toString()
    val caps = cm.getNetworkCapabilities(network)
    val isWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    val isCell = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
    val o = JSONObject()
      .put("adapterId", lp.interfaceName ?: "network")
      .put("name", lp.interfaceName ?: "")
      .put("description", if (isWifi) "Wi-Fi" else if (isCell) "Mobile data" else "Network")
      .put("isWifi", isWifi)
      .put("mac", "")

    val ipv4 = JSONArray()
    val ipv6 = JSONArray()
    for (la in lp.linkAddresses) {
      when (val a = la.address) {
        is Inet4Address -> ipv4.put(JSONObject().put("address", a.hostAddress).put("prefix", la.prefixLength))
        is Inet6Address -> ipv6.put(host(a))
      }
    }
    o.put("ipv4", ipv4).put("ipv6", ipv6)
    lp.routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.let { o.put("gateway", host(it)) }
    lp.routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet6Address && !it.gateway!!.isAnyLocalAddress }
      ?.gateway?.let { o.put("gatewayV6", host(it)) }
    o.put("dnsServers", JSONArray(lp.dnsServers.map { host(it) }))
    if (Build.VERSION.SDK_INT >= 29) o.put("mtu", lp.mtu)

    if (isWifi) {
      val dhcp = wifi(ctx).dhcpInfo
      val server = if (Build.VERSION.SDK_INT >= 30) lp.dhcpServerAddress?.let { host(it) } else null
      val legacyServer = dhcp?.serverAddress?.takeIf { it != 0 }?.let { intToIp(it) }
      val dhcpServer = server ?: legacyServer
      o.put("dhcpEnabled", dhcpServer != null)
      dhcpServer?.let { o.put("dhcpServer", it) }
      val info = wifi(ctx).connectionInfo
      if (info != null) {
        val rx = if (Build.VERSION.SDK_INT >= 29 && info.rxLinkSpeedMbps > 0) info.rxLinkSpeedMbps else info.linkSpeed
        val tx = if (Build.VERSION.SDK_INT >= 29 && info.txLinkSpeedMbps > 0) info.txLinkSpeedMbps else info.linkSpeed
        o.put("rxLinkBps", rx.coerceAtLeast(0).toLong() * 1_000_000L)
        o.put("txLinkBps", tx.coerceAtLeast(0).toLong() * 1_000_000L)
      }
    } else if (caps != null) {
      o.put("rxLinkBps", caps.linkDownstreamBandwidthKbps.toLong() * 1000L)
      o.put("txLinkBps", caps.linkUpstreamBandwidthKbps.toLong() * 1000L)
    }
    return o.toString()
  }

  @JvmStatic
  fun deviceInfo(ctx: Context): String {
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    val o = JSONObject()
      .put("powerSave", pm.isPowerSaveMode)
      .put("hasPermission", hasPermission(ctx))
      .put("locationOn", locationOn(ctx))
    if (Build.VERSION.SDK_INT >= 23) o.put("charging", bm.isCharging)
    val capacity = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    if (capacity in 0..100) o.put("batteryPercent", capacity)
    return o.toString()
  }

  /**
   * "location": asks for the permission while Android still shows the prompt,
   * otherwise opens the app's permission screen; with the permission granted but
   * location turned off, opens the location switch. "wifi" and "app" open those screens.
   */
  @JvmStatic
  fun openSettings(ctx: Context, page: String): String {
    val activity = ctx as? Activity
    when (page) {
      "location" -> when {
        !hasPermission(ctx) && activity != null && canAskLocation(activity) -> {
          ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ASKED_LOCATION, true).apply()
          activity.runOnUiThread { MainActivity.requestLocation(activity) }
          return "requested"
        }
        !hasPermission(ctx) -> open(ctx, appDetails(ctx))
        else -> open(ctx, Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
      }
      "wifi" -> open(ctx, Intent(Settings.ACTION_WIFI_SETTINGS))
      else -> open(ctx, appDetails(ctx))
    }
    return "opened"
  }

  /** After a "don't ask again" Android silently ignores the request, so settings are the only way. */
  private fun canAskLocation(activity: Activity): Boolean {
    val asked = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ASKED_LOCATION, false)
    return !asked || activity.shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)
  }

  /**
   * Saves an exported report into Downloads. The argument is the file name, a
   * newline, then the contents. Android 10+ goes through MediaStore (no storage
   * permission); older versions use the app's own Downloads folder.
   */
  @JvmStatic
  fun saveDownload(ctx: Context, payload: String): String {
    val name = payload.substringBefore('\n')
    val contents = payload.substringAfter('\n')
    val mime = if (name.endsWith(".json")) "application/json" else "text/markdown"
    if (Build.VERSION.SDK_INT >= 29) {
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, name)
        put(MediaStore.Downloads.MIME_TYPE, mime)
        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
      }
      val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("insert failed")
      ctx.contentResolver.openOutputStream(uri)!!.use { it.write(contents.toByteArray()) }
      return "${Environment.DIRECTORY_DOWNLOADS}/$name"
    }
    val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: ctx.filesDir
    val file = java.io.File(dir, name)
    file.writeText(contents)
    return file.absolutePath
  }

  private fun appDetails(ctx: Context) =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))

  private fun open(ctx: Context, intent: Intent) {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(intent)
    } catch (_: Exception) {
      ctx.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun informationElements(r: ScanResult): String? {
    if (Build.VERSION.SDK_INT < 30) return null
    val sb = StringBuilder()
    for (ie in r.informationElements) {
      val buf = ie.bytes.duplicate()
      val body = ByteArray(buf.remaining())
      buf.get(body)
      val header = if (ie.id == 255) byteArrayOf(255.toByte(), (body.size + 1).toByte(), ie.idExt.toByte())
      else byteArrayOf(ie.id.toByte(), body.size.toByte())
      if (body.size > 254) continue
      for (b in header + body) sb.append(String.format("%02x", b.toInt() and 0xff))
    }
    return sb.toString()
  }

  /** ScanResult.WIFI_STANDARD_* to the names used by the Windows backend. */
  private fun standardName(standard: Int, frequency: Int): String? = when (standard) {
    1 -> if (frequency < 3000) "g" else "a"
    4 -> "n"
    5 -> "ac"
    6 -> "ax"
    7 -> "ad"
    8 -> "be"
    else -> null
  }

  /** WifiInfo.SECURITY_TYPE_* to the Windows backend's security names. */
  private fun securityName(type: Int): String? = when (type) {
    0 -> "open"
    1 -> "wep"
    2 -> "wpa2-personal"
    3 -> "wpa2-enterprise"
    4 -> "wpa3-personal"
    5 -> "owe"
    8, 9 -> "wpa3-enterprise"
    else -> null
  }

  private fun host(a: InetAddress): String = (a.hostAddress ?: "").substringBefore('%')

  private fun intToIp(v: Int): String = "${v and 0xff}.${v shr 8 and 0xff}.${v shr 16 and 0xff}.${v shr 24 and 0xff}"
}
