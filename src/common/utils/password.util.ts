const MIN_LENGTH = 8;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[^A-Za-z0-9]/;

export function isPasswordStrong(password: string): boolean {
  return (
    password.length >= MIN_LENGTH &&
    HAS_DIGIT.test(password) &&
    HAS_SPECIAL.test(password)
  );
}

export function passwordStrengthMessage(): string {
  return 'Password must be at least 8 characters and include a digit and a special character';
}
