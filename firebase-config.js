// Replace the placeholder values with your Firebase Web App configuration.

export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "PASTE_YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

export const firebaseConfigured =
  firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY" &&
  firebaseConfig.projectId !== "YOUR_PROJECT_ID" &&
  firebaseConfig.appId !== "PASTE_YOUR_APP_ID" &&
  firebaseConfig.databaseURL !== "PASTE_YOUR_DATABASE_URL";