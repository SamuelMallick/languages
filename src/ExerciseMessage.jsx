import { useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseExerciseContent } from '../shared/exercises.js';

export default function ExerciseMessage({ message, submittedAnswers, disabled, onSubmit }) {
  const { parts, questions } = parseExerciseContent(message.content);
  const [answers, setAnswers] = useState(() => submittedAnswers || questions.map(() => ''));
  const id = useId();
  if (!questions.length) return <ReactMarkdown>{message.content}</ReactMarkdown>;
  const unchanged = submittedAnswers && answers.every((answer, i) => answer.trim() === submittedAnswers[i]);
  return <form className="exercise-questions" onSubmit={e => { e.preventDefault(); if (!disabled && !unchanged) onSubmit({ messageId: message.id, answers: answers.map(answer => answer.trim()) }); }}>
    {parts.map((part, i) => part.type === 'text' ? <ReactMarkdown key={i}>{part.content}</ReactMarkdown> : <div className="exercise-question" key={i}>
      <div id={`${id}-question-${part.index}`}><ReactMarkdown>{part.content}</ReactMarkdown></div>
      <label htmlFor={`${id}-answer-${part.index}`}>Answer {part.index + 1}</label>
      <textarea id={`${id}-answer-${part.index}`} aria-describedby={`${id}-question-${part.index}`} rows={3} required maxLength={1000} disabled={disabled} value={answers[part.index] || ''} onChange={e => setAnswers(current => current.map((answer, index) => index === part.index ? e.target.value : answer))} />
    </div>)}
    <div className="exercise-submit"><button className="button secondary small-button" disabled={disabled || unchanged || answers.some(answer => !answer.trim())}>Check answers</button>{unchanged && <span className="small muted" role="status">Answers submitted</span>}</div>
  </form>;
}
