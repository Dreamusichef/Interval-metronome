'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PROFILE VALIDATION — shared rules for public alias + avatar URL.
   Used by Cloud.updateProfile and unit tests.
   ════════════════════════════════════════════════════════════════════════════ */
const ProfileValidation = (() => {
  const MIN_NAME = 2;
  const MAX_NAME = 32;

  function sanitizeName(raw) {
    return String(raw == null ? '' : raw).replace(/[\x00-\x1f\x7f]/g, '').trim();
  }

  function validateProfileFields(input) {
    const display_name = sanitizeName(input && input.display_name);
    if (display_name.length < MIN_NAME) return { error: 'alias-too-short' };
    if (display_name.length > MAX_NAME) return { error: 'alias-too-long' };

    let avatar_url = input && input.avatar_url;
    if (avatar_url != null) {
      avatar_url = String(avatar_url).trim();
      if (!avatar_url) avatar_url = null;
      else if (!avatar_url.startsWith('https://')) return { error: 'avatar-invalid-url' };
    }

    return { value: { display_name, avatar_url: avatar_url == null ? null : avatar_url } };
  }

  return { validateProfileFields, sanitizeName, MIN_NAME, MAX_NAME };
})();

if (typeof window !== 'undefined') window.ProfileValidation = ProfileValidation;
if (typeof module !== 'undefined' && module.exports) module.exports = ProfileValidation;
