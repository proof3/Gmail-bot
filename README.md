# Gmail-bot
This a node.js app that uses the google Gmail API to reply to emails while your on Holiday.

# To Use:
Simply run 
```
node . 
```
or 
```
node index.js
``` 
# Libraries used
## @google-cloud
The app uses the google cloud library for OAuth2 Authentication to gain permission to read and write user emails.
## @google
G-Mail is accessed with the google library like so: 
```
 const gmail = google.gmail({version: 'v1', auth});
```
We can then use the gmail api by accesing different service endpoints through the google client libraries. 
This link https://developers.google.com/gmail/api/reference/rest shows all the different api services and service endpoints available.

This project makes use of the api services users, users.history, users.labels, users.messages and users.threads.