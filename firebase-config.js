
export const firebaseConfig = {
  apiKey: "AIzaSyCIAJ0tlK7MX8aMb_HEG3xmrS5FarYrYrQ",
  authDomain: "pushup-challenger-84663.firebaseapp.com",
  databaseURL: "https://pushup-challenger-84663-default-rtdb.firebaseio.com",
  projectId: "pushup-challenger-84663",
  storageBucket: "pushup-challenger-84663.firebasestorage.app",
  messagingSenderId: "849739567505",
  appId: "1:849739567505:web:b5392b6e10c3867bef0a30",
  measurementId: "G-HRMPPX7HRF"
};

export const firebaseConfigured =
  firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY" &&
  firebaseConfig.projectId !== "YOUR_PROJECT_ID" &&
  firebaseConfig.appId !== "PASTE_YOUR_APP_ID" &&
  firebaseConfig.databaseURL !== "PASTE_YOUR_REAL_DATABASE_URL";
