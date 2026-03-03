import { SignJWT, importPKCS8 } from 'jose';
import fetch from 'node-fetch';

const privateKeyPEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJGKo77jzCa0FGWpzqRpXPnc5pWq/vydVDkkEQLy3mpB
-----END PRIVATE KEY-----`;

const JWT_ISSUER = "hmm.app";
const JWT_AUDIENCE = "hmm.clients";

async function test() {
    const pk = await importPKCS8(privateKeyPEM, 'EdDSA');

    // Use a known user ID
    const userId = 'test-user-delhi-female-2';

    const token = await new SignJWT({ sub: userId, uid: userId })
        .setProtectedHeader({ alg: "EdDSA" })
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(pk);

    console.log('Generated token:', token);

    const res = await fetch('http://localhost:3002/me/profile', {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: 'testuser' })
    });

    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response:', text);
}

test();
