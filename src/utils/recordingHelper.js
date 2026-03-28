const fs = require("fs");
const path = require("path");

const mergeChunks = ({ account_id, session_id }) => {
  const folder = path.join(__dirname, "recordings", account_id, session_id);
  const finalFilePath = path.join(folder, "final_recording.webm");

  const chunks = fs.readdirSync(folder)
    .filter(f => f.endsWith(".webm"))
    .sort();

  const writeStream = fs.createWriteStream(finalFilePath);

  for (const chunk of chunks) {
    const data = fs.readFileSync(path.join(folder, chunk));
    writeStream.write(data);
  }

  writeStream.end();

  return finalFilePath;
}