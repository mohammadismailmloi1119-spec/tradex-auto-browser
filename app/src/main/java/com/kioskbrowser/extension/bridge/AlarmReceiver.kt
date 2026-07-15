/*
 * AlarmReceiver — handles chrome.alarms via Android AlarmManager.
 */

package com.kioskbrowser.extension.bridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class AlarmReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "AlarmReceiver"
        const val ACTION_ALARM_FIRED = "com.kioskbrowser.ALARM_FIRED"
        const val EXTRA_ALARM_NAME = "alarm_name"
        const val EXTRA_EXTENSION_ID = "extension_id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val alarmName = intent.getStringExtra(EXTRA_ALARM_NAME) ?: ""
        Log.d(TAG, "Alarm fired: $alarmName")
        val relay = Intent(ACTION_ALARM_FIRED).apply {
            putExtra(EXTRA_ALARM_NAME, alarmName)
            putExtra(EXTRA_EXTENSION_ID, intent.getStringExtra(EXTRA_EXTENSION_ID) ?: "")
            setPackage(context.packageName)
        }
        context.sendBroadcast(relay)
    }
}
