import { exportJWK, importPKCS8 } from 'jose';

const privateKeyPEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJGKo77jzCa0FGWpzqRpXPnc5pWq/vydVDkkEQLy3mpB
-----END PRIVATE KEY-----`;

async function check() {
    try {
        const pk = await importPKCS8(privateKeyPEM, 'EdDSA');
        const jwk = await exportJWK(pk);
        console.log('Public JWK:', JSON.stringify(jwk));
    } catch (err) {
        console.error('Error:', err);
    }
}

check();
