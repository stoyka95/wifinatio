package cz.semakod.wifinatio

import android.Manifest
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // The app paints a dark glass background, so the system bars get light icons.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    window.decorView.setBackgroundColor(Color.rgb(10, 15, 36))

    // Keep the web content clear of the status bar, navigation bar and cutouts.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }

    // Wi-Fi names and scan results need location access; notifications report outages.
    requestLocation(this)
  }

  companion object {
    private const val REQUEST_CODE = 4201

    fun requestLocation(activity: Activity) {
      val wanted = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
      if (Build.VERSION.SDK_INT >= 33) wanted += Manifest.permission.POST_NOTIFICATIONS
      val missing = wanted.filter { activity.checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED }
      if (missing.isNotEmpty()) activity.requestPermissions(missing.toTypedArray(), REQUEST_CODE)
    }
  }
}
