// The `.js` suffix is required: this file is emitted as a native ES module and
// loaded directly by Chrome as an MV3 service worker, which will not resolve an
// extensionless specifier. TypeScript maps it back to environment.ts.
import { environment } from './environments/environment.js';

const ALARM_NAME = 'POLL_ALERTS_ALARM';
const POLL_INTERVAL_MINUTES = 1;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
  console.log('Background worker installed and alarm scheduled.');
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await pollAlerts();
  }
});

async function pollAlerts() {
  try {
    const data = await chrome.storage.local.get(['X-API-TOKEN', 'traderId']);
    const token = data['X-API-TOKEN'] as string;
    const traderId = data['traderId'] as string;

    if (!token || !traderId) {
      return; // Not authenticated
    }

    const response = await fetch(`${environment.apiUrl}/extension/alerts/${traderId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-TOKEN': token
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch alerts:', response.status);
      return;
    }

    const alerts = await response.json();
    
    // Check if there are unread alerts
    const unreadAlerts = alerts.filter((alert: any) => !alert.isRead);

    if (unreadAlerts.length > 0) {
      chrome.action.setBadgeText({ text: unreadAlerts.length.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

      // Take the most recent alert for notification
      const latestAlert = unreadAlerts[0];
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon.png', // Assuming we'll have an icon, fallbacks gracefully if missing
        title: `New Alert: ${latestAlert.type || 'Activity'}`,
        message: latestAlert.message || 'You have new unread alerts.',
        priority: 2
      });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('Error polling alerts:', err);
  }
}
