const crypto = require("crypto");

const generateComplexPassword = ({ length = 12 }) => {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const special = "!@#$%^&*";
  
  // Ensure at least one from each category
  let password = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    numbers[crypto.randomInt(0, numbers.length)],
    special[crypto.randomInt(0, special.length)]
  ];

  // Fill the rest of the password
  const all_chars = upper + lower + numbers + special;
  for (let i = password.length; i < length; i++) {
    password.push(all_chars[crypto.randomInt(0, all_chars.length)]);
  }

  // Shuffle the password so the required chars aren't predictable
  password = password.sort(() => 0.5 - Math.random());

  return password.join('');
}

module.exports = { generateComplexPassword };
