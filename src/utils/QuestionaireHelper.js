const pool = require("../db");
const { normalize } = require("./DataHelper");

const validateQuestionaire = async ({
  questionaire_answers = {},
  connection = pool,
}) => {
  try {
    const [questions] = await connection.query(`
      SELECT id, question FROM counseling_request_questions
      WHERE is_archived != ?
    `, [true]);

    const missing_fields = [];
    const answer_map = {};

    for (const question of questions) {
      const answer = normalize(questionaire_answers[question.id]);

      answer_map[question.question] = answer || null;

      if (!(question.id in questionaire_answers) || !answer) {
        missing_fields.push(question.id);
      }
    }

    const valid = missing_fields.length === 0;

    return { valid, answer_map, missing_fields };
  } catch (e) {
    throw e;
  }
};

module.exports = { validateQuestionaire };
