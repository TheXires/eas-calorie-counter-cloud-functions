import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const firebaseTools = require('firebase-tools');
const firebase = admin.initializeApp();

export const deleteUser = functions.https.onCall(async (_, context) => {
  if (!context.auth) {
    console.log('permission-denied');
    throw new functions.https.HttpsError(
      'permission-denied',
      'Unauthorized request. Login to delete your Account.',
    );
  }

  const userId = context.auth.uid;
  console.log(`User ${userId} requested account deletion`);

  const project = process.env.GCLOUD_PROJECT;
  const token = functions.config().fb.token;

  const path = `users/${userId}`;
  const bucket = firebase.storage().bucket();

  console.log(`start deleting ${path}`);

  await firebaseTools.firestore.delete(path, {
    project,
    recursive: true,
    yes: true,
    token,
    force: true,
  });

  // https://medium.com/google-developer-experts/automatically-delete-your-firebase-storage-files-from-firestore-with-cloud-functions-for-firebase-36542c39ba0d
  await bucket.deleteFiles({
    prefix: userId,
  });

  await firebase.auth().deleteUser(userId);

  console.log('finished');

  return {
    deleted: true,
  };
});
