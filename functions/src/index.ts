import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const firebaseTools = require('firebase-tools');

const firebase = admin.initializeApp();
const db = admin.firestore();

/**
 * get the start time of today
 *
 * @returns start of today in ms
 */
const getStartOfToday = (): number => {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  return todayStart.getTime();
};

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
  functions.logger.log(`User ${userId} requested account deletion`);

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

  functions.logger.log(`Deleted User ${userId}`);

  return {
    deleted: true,
  };
});

/**
 * creates and updates weight statistic whenever the users weight get changed
 */
export const createWeightStatistic = functions.firestore
  .document('users/{userId}')
  .onUpdate(async (snap, context) => {
    functions.logger.log('detected weight change');

    const oldWeight = snap.after.data().settings.weight;
    const newWeight = snap.after.data().settings.weight;

    if (!oldWeight || !newWeight) return;

    const { userId } = context.params;
    if (!userId) return;
    const weightStatistic = await db
      .collection('users')
      .doc(userId)
      .collection('statistics')
      .doc('weightStatistic')
      .get();

    const weightHistory = weightStatistic.data()?.weightHistory;
    let newWeightHistory: any[] = [];
    const today = getStartOfToday();
    if (weightHistory) {
      newWeightHistory = [...weightHistory];
      const index = newWeightHistory.findIndex(
        (element: { date: number; weight: number }) => element.date === today,
      );
      if (index !== -1) {
        newWeightHistory[index].weight = newWeight;
      } else {
        newWeightHistory.push({ date: today, weight: newWeight });
      }
    } else {
      newWeightHistory[0] = { date: today, weight: newWeight };
    }

    functions.logger.log(newWeightHistory);

    await db
      .collection('users')
      .doc(userId)
      .collection('statistics')
      .doc('weightStatistic')
      .set({
        weightHistory: newWeightHistory,
        lastModified: Date.now(),
      });

    functions.logger.log('finished');
  });

/**
 * creates and updates statistics based on user consumptions
 */
export const createDailyStatistics = functions.https.onCall(
  async (_, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Unauthorized request. Login to create statistics.',
      );
    }

    const userId: string = context.auth.uid;
    functions.logger.log(`creating statistics for ${userId}`);

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

    functions.logger.log(`finished creating statistics for ${userId}`);

    return {
      updatedStatistics: true,
    };
  },
);
