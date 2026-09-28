// Entry point: registers every screen, then starts the app shell.
import { start } from './app.js';
import './screens/auth.js';
import './screens/customer.js';
import './screens/practitioner.js';
import './screens/vendor.js';
import './screens/admin.js';

start();
