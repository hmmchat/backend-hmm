
import axios from 'axios';

const FRIEND_SERVICE_URL = 'http://localhost:3009';

/**
 * Script to automatically link two users and send a test message.
 * Bypasses JWT auth using /internal and /test endpoints in dev mode.
 */
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.log('Usage: npx tsx scripts/test-friend-setup.ts <userId1> <userId2> "Message text"');
        console.log('Example: npx tsx scripts/test-friend-setup.ts cmlj3... cmlj7... "Hello from the script!"');
        return;
    }

    const [userId1, userId2, message] = args;

    try {
        // 1. Create Friendship (Internal)
        console.log(`Step 1: Creating friendship between ${userId1} and ${userId2}...`);
        await axios.post(`${FRIEND_SERVICE_URL}/internal/friends/auto-create`, {
            userId1,
            userId2
        }, {
            headers: { 'x-service-token': 'development' } // Most local configs use 'development' or ignore in test mode
        });
        console.log('✅ Friendship created.');

        // 2. Send Test Message (Test Endpoint)
        console.log(`Step 2: Sending message from ${userId1} to ${userId2}...`);
        await axios.post(`${FRIEND_SERVICE_URL}/test/friends/${userId2}/messages?fromUserId=${userId1}`, {
            message: message
        });
        console.log('✅ Message sent.');

        console.log('\nDone! You can now check the Inbox in the UI.');
    } catch (error: any) {
        console.error('❌ Error:', error.response?.data || error.message);
    }
}

main();
