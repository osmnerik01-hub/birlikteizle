import { readFile, writeFile } from 'node:fs/promises';
const rules = JSON.parse(await readFile('database.rules.json', 'utf8'));
const admin = "(auth != null && auth.token.email_verified === true && auth.token.firebase.sign_in_provider === 'google.com' && root.child('siteConfig/adminEmail').isString() && auth.token.email === root.child('siteConfig/adminEmail').val())";
const base = "root.child('birlikteRooms').child($room)";
const member = `auth != null && ${base}.child('members').hasChild(auth.uid)`;
const owner = `auth != null && ${base}.child('meta/host').val() === auth.uid`;
const open = `${base}.child('closed').val() !== true`;
const allowed = key => `(${member} && ${base}.child('permissions').child(auth.uid).child('${key}').val() === true)`;
const privileged = `(${owner} || ${admin})`;
const room = rules.rules.birlikteRooms.$room;
room['.read'] = `(${member}) || ${admin}`;
room['.write'] = `${admin} && !newData.exists() || (auth != null && !newData.exists() && (!data.exists() || (!data.child('presence').exists() && (data.child('lifecycle/lastActiveAt').isNumber() ? data.child('lifecycle/lastActiveAt').val() : data.child('meta/createdAt').val()) <= now - 86400000))) || (auth != null && !data.exists() && newData.exists() && $room.matches(/^[a-f0-9-]{36}$/) && newData.child('meta/host').val() === auth.uid && newData.child('members').hasChild(auth.uid))`;
room.meta.title['.write'] = privileged;
room.meta.host['.write'] = admin;
room.meta.host['.validate'] = `newData.isString() && (newData.val() === data.val() || (!data.exists() && newData.val() === auth.uid) || (${admin} && ${base}.child('members').hasChild(newData.val())))`;
room.meta.createdAt['.validate'] = 'newData.isNumber() && (newData.val() === data.val() || (!data.exists() && newData.val() === now))';
room.closed = { '.write': privileged, '.validate': 'newData.isBoolean()' };
room.lifecycle = {
  lastActiveAt: { '.write': member, '.validate': 'newData.isNumber() && newData.val() === now' },
  '$other': { '.validate': false }
};
room.members.$uid['.write'] = `auth != null && auth.uid === $uid && ${base}.child('meta').exists() && ${open} && newData.exists()`;
room.permissions = { '$uid': {
  '.write': privileged,
  '.validate': `${base}.child('members').hasChild($uid) && newData.hasChildren(['addVideo', 'manageQueue', 'playback'])`,
  ...Object.fromEntries(['addVideo','manageQueue','playback'].map(key => [key, { '.validate': 'newData.isBoolean()' }])),
  '$other': { '.validate': false }
} };
room.queue.$slot['.write'] = `${open} && (${privileged} || ${allowed('manageQueue')} || (${allowed('addVideo')} && !data.exists() && newData.exists()))`;
room.playback['.write'] = `${open} && (${privileged} || (${allowed('playback')} && newData.child('videoId').val() === data.child('videoId').val()) || (${allowed('manageQueue')} && newData.child('videoId').val() !== data.child('videoId').val() && newData.child('playing').val() === false && newData.child('time').val() === 0)) && newData.exists()`;
room.playback['.validate'] = "newData.hasChildren(['videoId', 'time', 'playing', 'updatedAt', 'controller'])";
room.playback.controller = { '.validate': `newData.isString() && (newData.val() === auth.uid || (${privileged} && newData.val() === data.val()))` };
room.messages.$slot['.write'] = `(${member} && ${open} && newData.exists()) || (${admin} && !newData.exists())`;
room.messages['.write'] = `${admin} && !newData.exists()`;
rules.rules.siteConfig = { '.read': admin, '.write': false };
rules.rules.roomIndex = {
  '.read': `${admin} || (auth != null && root.child('cleanupClock').isNumber() && query.orderByValue === true && query.endAt === root.child('cleanupClock').val() - 86400000 && query.limitToFirst > 0 && query.limitToFirst <= 50)`,
  '.indexOn': '.value',
  '$room': {
    '.write': `${admin} || ((${member}) && newData.val() === now) || (auth != null && !newData.exists() && !${base}.exists())`,
    '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= now'
  }
};
rules.rules.cleanupClock = { '.read': 'auth != null', '.write': 'auth != null && newData.isNumber() && newData.val() === now && (!data.exists() || now - data.val() >= 60000)' };
rules.rules.roomLocations = { '$room': {
  '.read': admin,
  '.write': `${admin} && !newData.exists() || (auth != null && !newData.exists() && !${base}.exists())`,
  '$uid': {
    '.write': `auth != null && auth.uid === $uid && ${base}.child('members').hasChild(auth.uid) && ${open}`,
    '.validate': "newData.hasChildren(['region', 'country', 'at'])",
    region: { '.validate': 'newData.isString() && newData.val().length > 0 && newData.val().length <= 80' },
    country: { '.validate': 'newData.isString() && newData.val().matches(/^[A-Z]{2}$/)' },
    at: { '.validate': 'newData.isNumber() && newData.val() === now' },
    '$other': { '.validate': false }
  }
} };
await writeFile('database.rules.json', JSON.stringify(rules, null, 2) + '\n');
