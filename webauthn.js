const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

const currentChallenges = new Map();
const rpName = 'Portfolio Security';

module.exports = function(app, db, authenticate, preAuthSessions, activeSessions, failedAttempts, globalBlockedIps) {
  
  // ============================================
  // REGISTRATION (Settings -> Register Device)
  // ============================================
  app.get('/api/webauthn/generate-registration-options', authenticate, async (req, res) => {
    const creds = await db.getCredentials();
    const authenticators = creds.authenticators || [];
    
    const rpID = req.hostname;
    
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new Uint8Array(Buffer.from('admin-user-id-123')), // Fixed ID for single admin
      userName: creds.email,
      attestationType: 'none',
      excludeCredentials: authenticators.map(auth => ({
        id: Buffer.from(auth.credentialID, 'base64'),
        type: 'public-key',
      })),
      authenticatorSelection: {
        userVerification: 'required'
      }
    });

    const token = req.headers['authorization'].split(' ')[1];
    currentChallenges.set(token, options.challenge);

    res.json(options);
  });

  app.post('/api/webauthn/verify-registration', authenticate, async (req, res) => {
    const token = req.headers['authorization'].split(' ')[1];
    const expectedChallenge = currentChallenges.get(token);
    
    if (!expectedChallenge) return res.status(400).json({ error: 'No active challenge' });

    const creds = await db.getCredentials();
    const rpID = req.hostname;

    try {
      const origin = req.hostname === 'localhost' || req.hostname === '127.0.0.1' 
        ? `http://${req.hostname}:3000` 
        : `https://${req.hostname}`;

      const verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });

      if (verification.verified && verification.registrationInfo) {
        const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
        
        const authenticators = creds.authenticators || [];
        authenticators.push({
          credentialID: Buffer.from(credentialID).toString('base64'),
          credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64'),
          counter,
        });

        await db.saveCredentials({ ...creds, authenticators });
        currentChallenges.delete(token);
        
        res.json({ verified: true });
      } else {
        res.status(400).json({ error: 'Registration verification failed' });
      }
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: error.message });
    }
  });

  // ============================================
  // AUTHENTICATION (Login Step 2)
  // ============================================
  app.get('/api/webauthn/generate-authentication-options', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Missing step 1 token' });
    const preToken = authHeader.split(' ')[1];
    
    if (!preAuthSessions.has(preToken)) return res.status(401).json({ error: 'Invalid step 1 token' });

    const creds = await db.getCredentials();
    const authenticators = creds.authenticators || [];
    
    if (authenticators.length === 0) {
        return res.status(400).json({ error: 'No biometrics registered' });
    }

    const rpID = req.hostname;
    
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: authenticators.map(auth => ({
        id: Buffer.from(auth.credentialID, 'base64'),
        type: 'public-key',
      })),
      userVerification: 'required',
    });

    currentChallenges.set(preToken, options.challenge);
    res.json(options);
  });

  app.post('/api/webauthn/verify-authentication', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Missing step 1 token' });
    const preToken = authHeader.split(' ')[1];
    
    const preSession = preAuthSessions.get(preToken);
    if (!preSession) return res.status(401).json({ error: 'Invalid step 1 token' });

    const expectedChallenge = currentChallenges.get(preToken);
    if (!expectedChallenge) return res.status(400).json({ error: 'No active challenge' });

    const creds = await db.getCredentials();
    const authenticators = creds.authenticators || [];
    const rpID = req.hostname;
    const body = req.body;

    const authenticator = authenticators.find(
      auth => auth.credentialID === body.id
    );

    if (!authenticator) {
      return res.status(400).json({ error: 'Authenticator is not registered with this site' });
    }

    try {
      const origin = req.hostname === 'localhost' || req.hostname === '127.0.0.1' 
        ? `http://${req.hostname}:3000` 
        : `https://${req.hostname}`;
        
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        authenticator: {
          credentialID: Buffer.from(authenticator.credentialID, 'base64'),
          credentialPublicKey: Buffer.from(authenticator.credentialPublicKey, 'base64'),
          counter: authenticator.counter,
        },
        requireUserVerification: true,
      });

      if (verification.verified) {
        // Update counter
        authenticator.counter = verification.authenticationInfo.newCounter;
        await db.saveCredentials(creds);

        currentChallenges.delete(preToken);
        preAuthSessions.delete(preToken);

        // Issue Full Auth Token!
        const fullToken = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        activeSessions.set(fullToken, { lastActive: Date.now() });
        
        // Reset failed attempts since they fully logged in
        failedAttempts.delete(preSession.ip);

        res.json({ verified: true, token: fullToken });
      } else {
        throw new Error('Verification failed internally');
      }
    } catch (error) {
      console.error(error);
      
      // BIOMETRIC FAILURE PENALTY:
      // If they fail the biometric prompt, trigger the Block
      const ip = preSession.ip;
      if (!globalBlockedIps.has(ip)) {
        await db.addBlockedIp({ 
          ip, 
          timestamp: new Date().toISOString(), 
          userAgent: req.headers['user-agent'] || 'Failed Biometric' 
        });
        globalBlockedIps.add(ip);
      }
      res.cookie('banned_device', ip, { maxAge: 9999999999, httpOnly: false });
      
      res.status(403).json({ error: 'Biometric verification failed. Device permanently blocked.', deviceBlocked: true, web3FormsKey: process.env.WEB3FORMS_KEY || '', blockedIp: ip });
    }
  });
};
