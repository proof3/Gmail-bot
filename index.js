import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import {authenticate} from '@google-cloud/local-auth';
import {google} from 'googleapis';
import { get } from 'http';

// If modifying these scopes, delete token.json.
const SCOPES = ['https://mail.google.com/',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send',];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const LABEL_PATH = path.join(process.cwd(), 'label.json');

// timer for calling watchGmail
let timer;
let lastHistoryId = undefined;
let labelId = undefined;
const respondedThreads = new Set();

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
    
    //login in to gmail and get user profile to updat historyId
    const gmail = google.gmail({version: 'v1', auth});
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    //check if historyId is initialized
    if (lastHistoryId) {

        //retreive all messages added since last sync
        const res = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: lastHistoryId,
            historyTypes: ['messageAdded'],
            format: 'raw',
        });

        const history =  res.data.history;
        
        //check if there are any history records
        if (history && history.length > 0) {

            for (const message of history) {
                console.log(message);
                if (message) await processMessages(message.messagesAdded, gmail);
            }
        }
    }


    lastHistoryId = profile.data.historyId;
    console.log(lastHistoryId);

    const timeoutValue = Math.random() * (120-45) + 45;
    console.log(timeoutValue);
    timer = setTimeout(() => watchGmail(auth), timeoutValue * 1000);
}


async function processMessages(history, gmail) {

    for (const {message} of history) {

        if (message) {

            const threadId = message.threadId;
            const id = message.id;

            //check if replied to thread
            if (respondedThreads.has(threadId)) {
                console.log('already replied to thread');
                continue;
            }

            try {

                const content = await gmail.users.messages.get({
                    userId: 'me',
                    id: id,
                });

                //parse headers to get from, to, subject, references, inReplyTo.
                const headers = content.data.payload.headers;
                let from, to, subject, references, inReplyTo;
                console.log(headers);

                for (const header of headers) {

                    switch (header.name) {

                        case 'From':
                            to = header.value;
                            break;
                        case 'To':
                            from = header.value;
                            break;
                        case 'Subject':
                            subject = header.value;
                            break;
                        case 'Message-ID':
                            references = header.value;
                            inReplyTo = header.value;
                            break;
                        default:
                            break;
                    }
                }
                
                const newThreadReply = await replyToMessage(gmail, from, to, subject, references, inReplyTo);

                if (newThreadReply !== '') {
                    respondedThreads.add(newThreadReply);

                    //create label if it doesnt exist and add to thread
                    if (labelId === undefined) {
                        const label = await loadSavedLabelIfExist();
                        if  (label) {
                            labelId = label.id;
                        }
                        else {
                            const createdLabel = await createLabel(gmail);
                            saveLabel(createdLabel.data);
                            labelId = createdLabel.data.id;
                        }
                    }

                    await addLabelToThread(gmail, newThreadReply);
                }

            } catch (e) {

                console.error('DID NOT GET MESSAGE', {
                    messageId: id,
                    error: e.message,
                });
            }
        }
    }
}

async function loadSavedLabelIfExist() {
    try {
        const content = await fs.readFile(LABEL_PATH);
        const label = JSON.parse(content);
        return label;
    } catch (err) {
        return null;
    }
}

async function saveLabel(label) {

    const payload = JSON.stringify(label);
    await fs.writeFile(LABEL_PATH, payload);
}

async function createLabel(gmail) {

    // create new label
    let label;

    //create label
    try {
        label = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name: 'Emails_Replied_To',
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            },
        });
    }
    catch (e) {
        console.error('DID NOT CREATE LABEL', {
            error: e.message,
        });
    }

    return label;     
}

async function addLabelToThread(gmail, threadId) {

    try {
        await gmail.users.threads.modify({
            userId: 'me',
            id: threadId,
            requestBody: {
                addLabelIds: [labelId],
            },
        });
    }
    catch (e) {
        console.error('DID NOT ADD LABEL', {
            error: e.message,
        });
    }
}

async function replyToMessage(gmail, from, to, subject, references, inReplyTo) {

    const messageParts = [
        `From: ${from}`,
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: Re: ${subject}`,
        `References: ${references}`,
        `In-Reply-To: ${inReplyTo}`,
        '',
        'This is a message just to say hello.',
        'So... <b>Hello!</b>  🤘❤️😎',
    ];
    const message = messageParts.join('\n');
    
    // The body needs to be base64url encoded.
    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    try {

        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
              raw: encodedMessage,
            },
          });

        console.log(res.data);
        return res.data.threadId;
    }
    catch (e) {

        console.error('DID NOT SEND MESSAGE', {
            error: e.message,
        });
    }

    return '';
}

authorize().then(watchGmail).catch(console.error);
