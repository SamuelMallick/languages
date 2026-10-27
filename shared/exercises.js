export const EXERCISE_FORMAT_INSTRUCTIONS = `When you give the student practice questions, exercises, quizzes, translation tasks, or role-play prompts to answer, wrap EACH individual question in its own <practice-question>...</practice-question> block. Put all information needed to answer (including any choices or sub-instructions) inside that block. Use at most 12 questions per reply, with one answerable task per block. Markdown is allowed inside a block. Put any introduction or general instructions outside the blocks. Do not include solutions until the student attempts the questions. Do not use these blocks for explanations, summaries, worked examples, rhetorical questions, or feedback on submitted answers. The app displays an answer box under each block. When the student submits answers, check each answer against its question, explain corrections, and do not repeat those questions in new blocks. Example:\n<practice-question>Fill the gap: Ik ___ een boek. (lezen)</practice-question>`;

export function practiceQuestionsPrompt(language, grammar = false) {
  return grammar
    ? 'Give me three representative exercises for this section. Do not show the answers yet. After I attempt them, explain any corrections.'
    : `Give me three practice questions in ${language.name}, appropriate to my language level. Do not show the answers yet. After I attempt them, explain any corrections.`;
}

export function isInternalExerciseMessage(message, language, grammar = false) {
  if (message.role !== 'user') return false;
  // Exact prompt matching also covers conversations saved before action metadata.
  return Boolean(message.exercise || message.action === 'generate-practice' || message.content === practiceQuestionsPrompt(language, grammar));
}

// Explicit boundaries avoid mistaking numbered explanations or examples for questions.
export function parseExerciseContent(content) {
  const parts = [];
  const questions = [];
  const pattern = /<practice-question>\s*([\s\S]*?)\s*<\/practice-question>/g;
  let start = 0;
  for (const match of content.matchAll(pattern)) {
    const question = match[1].trim();
    if (!question) continue;
    if (match.index > start) parts.push({ type: 'text', content: content.slice(start, match.index) });
    parts.push({ type: 'question', content: question, index: questions.length });
    questions.push(question);
    start = match.index + match[0].length;
  }
  if (start < content.length) parts.push({ type: 'text', content: content.slice(start) });
  return { parts, questions };
}

export function formatExerciseAnswers(questions, answers) {
  return 'Please check each of my answers and explain any corrections.\n\n' + questions.map((question, i) => `Question ${i + 1}: ${question}\nMy answer: ${answers[i].trim()}`).join('\n\n');
}
