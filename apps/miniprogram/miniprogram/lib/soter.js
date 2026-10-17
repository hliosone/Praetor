// WeChat SOTER (spec 06 F2/F6): the mode comes from checkIsSupportSoterAuthentication's supportMode (Face ID iPhones
// answer ["facial"] and refuse fingerPrint with 90003, V11), the challenge is the digest computed on this phone.
function pickMode(supportMode) {
  const modes = Array.isArray(supportMode) ? supportMode : [];
  if (modes.indexOf('facial') >= 0) return 'facial';
  if (modes.indexOf('fingerPrint') >= 0) return 'fingerPrint';
  return null;
}

function startOptions(mode, challenge, authContent) {
  return { requestAuthModes: [mode], challenge, authContent };
}

/** The fields the api forwards to the attester; refuses a failed prompt or a result over another challenge. */
function checkResult(res, challenge) {
  if (!res || res.errCode !== 0) throw new Error(`SOTER failed (${res && res.errCode}): ${res && res.errMsg}`);
  let raw;
  try {
    raw = JSON.parse(res.resultJSON).raw;
  } catch (e) {
    raw = undefined;
  }
  if (raw !== challenge) throw new Error('SOTER signed another challenge (raw)');
  return { authMode: res.authMode, resultJSON: res.resultJSON, resultJSONSignature: res.resultJSONSignature };
}

module.exports = { pickMode, startOptions, checkResult };
