import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyARAjRjKBpRP9h1hIccJ_n1iqbON-vaHgs',
  authDomain: 'family-board-games-54639.firebaseapp.com',
  projectId: 'family-board-games-54639',
  storageBucket: 'family-board-games-54639.firebasestorage.app',
  messagingSenderId: '557276950036',
  appId: '1:557276950036:web:edac4d1cafc69480970101',
  databaseURL:
    'https://family-board-games-54639-default-rtdb.europe-west1.firebasedatabase.app/',
};

let app: FirebaseApp | null = null;
let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  }
  return db;
}
