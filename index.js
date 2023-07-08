import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import {authenticate} from '@google-cloud/local-auth';
import {google} from 'googleapis';

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// timer for calling watchGmail
let timer;
let lastHistoryId;

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {

    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

/**
 * Watch for changes in user's gmail account.
 */
async function watchGmail(auth) {
    
    const gmail = google.gmail({version: 'v1', auth});
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    if (lastHistoryId) {

        const res = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: lastHistoryId,
            historyTypes: ['messageAdded'],
        });

        const history =  res.data.history;

        if (history && history.length > 0) {
            console.log(history);

            for (const {message} of history[history.length-1].messagesAdded) {

                if (message) {
                    console.log(message.id);
                    const id = message.id;

                    try {
                        const content = await gmail.users.messages.get({
                            userId: 'me',
                            id: id,
                        });

                        console.log(content);

                    } catch (e) {

                        console.error('DID NOT GET MESSAGE', {
                            messageId: id,
                            error: e.message,
                        });
                    }
                }
            }
        }
    }

    lastHistoryId = profile.data.historyId;
    console.log(lastHistoryId);

    const timeoutValue = Math.random() * (120-45) + 45;
    console.log(timeoutValue);
    timer = setTimeout(() => watchGmail(auth), 15 * 1000);
}

authorize().then(watchGmail).catch(console.error);
