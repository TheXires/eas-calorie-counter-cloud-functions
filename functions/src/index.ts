import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const firebaseTools = require('firebase-tools');

const firebase = admin.initializeApp();
const db = admin.firestore();

/**
 * deletes all user data and the user itself
 */
export const deleteUser = functions.https.onCall(async (_, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Unauthorized request. Login to delete your Account.',
    );
  }

  const userId = context.auth.uid;
  console.log(`User ${userId} requested account deletion`);

  const path = `users/${userId}`;

  await firebaseTools.firestore.delete(path, {
    project: process.env.GCLOUD_PROJECT,
    recursive: true,
    yes: true,
    token: functions.config().fb.token,
    force: true,
  });

  // https://medium.com/google-developer-experts/automatically-delete-your-firebase-storage-files-from-firestore-with-cloud-functions-for-firebase-36542c39ba0d
  await firebase.storage().bucket().deleteFiles({
    prefix: userId,
  });

  await firebase.auth().deleteUser(userId);

  console.log(`Deleted User ${userId}`);

  return {
    deleted: true,
  };
});

/**
 * creates and updates statistics based on user consumptions
 */
export const createStatistics = functions.https.onCall(async (_, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Unauthorized request. Login to create statistics.',
    );
  }

  const userId: string = context.auth.uid;
  console.log(`creating statistics for ${userId}`);

  const statisticsDocument = await db
    .collection('users')
    .doc(userId)
    .collection('statistics')
    .doc('dailyStatistics')
    .get();

  const statisticsData = statisticsDocument.data()?.data ?? [];
  const lastModified: number = statisticsDocument.data()?.lastModified ?? 0;

  const modifiedConsumptionDocuments = await db
    .collection('users')
    .doc(userId)
    .collection('consumptions')
    .where('lastModified', '>=', lastModified)
    .get();

  if (modifiedConsumptionDocuments.docs.length <= 0) {
    return {
      updatedStatistics: false,
    };
  }

  modifiedConsumptionDocuments.docs.forEach((doc) => {
    const statisticValues = {
      date: doc.data().date,
      calories: 0,
      carbohydrates: 0,
      fat: 0,
      protein: 0,
    };

    if (doc.data().deleted != null && !doc.data().deleted) {
      doc.data().items.forEach((item: any) => {
        statisticValues.calories += item.calories * item.quantity;
        statisticValues.carbohydrates += item.carbohydrates * item.quantity;
        statisticValues.fat += item.fat * item.quantity;
        statisticValues.protein += item.protein * item.quantity;
      });

      const index = statisticsData.findIndex(
        (element: any) => element.date === doc.data().date,
      );

      if (index === -1) {
        statisticsData.push(statisticValues);
      } else {
        statisticsData[index] = statisticValues;
      }
    } else {
      const index = statisticsData.findIndex(
        (element: any) => element.date === doc.data().date,
      );
      if (index !== -1) statisticsData.splice(index, 1);
    }
  });

  await firebase
    .firestore()
    .collection('users')
    .doc(userId)
    .collection('statistics')
    .doc('dailyStatistics')
    .set({
      lastModified: Date.now(),
      data: statisticsData,
    });

  console.log(`finished creating statistics for ${userId}`);

  return {
    updatedStatistics: true,
  };
});
