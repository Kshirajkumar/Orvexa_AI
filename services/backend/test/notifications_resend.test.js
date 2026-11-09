const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotification, listNotifications, markNotificationsRead } = require('../lib/notifications');
const { isResendConfigured, sendEmail, testResendConnection } = require('../lib/resend');

test('Resend configuration and diagnostic check', async () => {
  assert.equal(typeof isResendConfigured(), 'boolean');
  const diagnostic = await testResendConnection();
  assert.equal(typeof diagnostic.configured, 'boolean');
});

test('Resend simulation and structure validation', async () => {
  // Test invalid recipient handling
  await assert.rejects(
    async () => sendEmail({ to: '', subject: 'test', html: '<p>test</p>' }),
    /At least one recipient email address/
  );
});

test('Notifications in-memory fallback and life cycle', async () => {
  const testUserId = 'test-user-' + Date.now();
  
  // Create a notification
  const notif = await createNotification({
    userId: testUserId,
    eventType: 'test.alert',
    title: 'Test Notification',
    message: 'Testing notifications service',
    entityType: 'test',
    metadata: { key: 'value' }
  });

  assert.ok(notif.id);
  assert.equal(notif.user_id, testUserId);
  assert.equal(notif.title, 'Test Notification');
  assert.equal(notif.read_at, null);

  // List notifications
  const list = await listNotifications({ userId: testUserId, limit: 10 });
  assert.ok(list.data.length >= 1);
  assert.equal(list.data[0].title, 'Test Notification');
  assert.ok(list.unreadCount >= 1);

  // Mark as read
  const marked = await markNotificationsRead({ userId: testUserId });
  assert.ok(marked.updated >= 1);

  // List again to verify read
  const listAfter = await listNotifications({ userId: testUserId, limit: 10 });
  assert.equal(listAfter.unreadCount, 0);
});

