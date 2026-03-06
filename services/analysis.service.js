/**
 * Analysis Service
 * Handles AI-powered message analysis using NLP techniques
 */

const db = require("../config/database");

// Simple sentiment analysis without external heavy dependencies
const analyzeSentiment = (text) => {
  const positiveWords = [
    "good",
    "great",
    "excellent",
    "amazing",
    "awesome",
    "fantastic",
    "wonderful",
    "love",
    "like",
    "happy",
    "pleased",
    "satisfied",
    "perfect",
    "best",
    "thanks",
    "thank",
    "appreciate",
    "helpful",
    "useful",
    "brilliant",
    "outstanding",
    "superb",
    "nice",
    "cool",
    "fine",
    "ok",
    "okay",
    "sure",
    "yes",
    "absolutely",
    "definitely",
    "agree",
    "correct",
    "right",
    "exactly",
    "precisely",
    "clear",
    "understood",
  ];

  const negativeWords = [
    "bad",
    "terrible",
    "awful",
    "horrible",
    "hate",
    "dislike",
    "angry",
    "mad",
    "frustrated",
    "annoyed",
    "disappointed",
    "worst",
    "useless",
    "stupid",
    "wrong",
    "no",
    "not",
    "never",
    "none",
    "nothing",
    "nobody",
    "nowhere",
    "neither",
    "disagree",
    "incorrect",
    "mistake",
    "error",
    "problem",
    "issue",
    "bug",
    "fail",
    "failed",
    "failure",
    "broken",
    "crash",
    "buggy",
    "slow",
    "lag",
  ];

  const urgentWords = [
    "urgent",
    "asap",
    "immediately",
    "quickly",
    "hurry",
    "rush",
    "emergency",
    "critical",
    "important",
    "priority",
    "deadline",
    "now",
    "today",
    "soon",
  ];

  const confusedWords = [
    "confused",
    "confusing",
    "unclear",
    "dont understand",
    "don't understand",
    "what do you mean",
    "not sure",
    "uncertain",
    "puzzled",
    "lost",
    "help",
    "explain",
    "clarify",
    "what",
    "how",
    "why",
    "when",
    "where",
    "who",
  ];

  const words = text.toLowerCase().match(/\b\w+\b/g) || [];

  let positive = 0;
  let negative = 0;
  let urgent = 0;
  let confused = 0;

  words.forEach((word) => {
    if (positiveWords.includes(word)) positive++;
    if (negativeWords.includes(word)) negative++;
    if (urgentWords.includes(word)) urgent++;
    if (confusedWords.includes(word)) confused++;
  });

  // Check phrases for confusion
  const lowerText = text.toLowerCase();
  if (
    lowerText.includes("?") ||
    lowerText.includes("what do you mean") ||
    lowerText.includes("dont understand") ||
    lowerText.includes("don't understand")
  ) {
    confused++;
  }

  // Determine tone
  if (urgent > 0) return "urgent";
  if (confused > 1) return "confused";
  if (positive > negative && positive > 0)
    return positive > 1 ? "very_positive" : "positive";
  if (negative > positive && negative > 0)
    return negative > 1 ? "very_negative" : "negative";
  return "neutral";
};

// Analyze clarity
const analyzeClarity = (text) => {
  const issues = [];
  let score = 100;

  // Check message length
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 3) {
    issues.push("Message is very short and may be unclear");
    score -= 20;
  } else if (wordCount < 5) {
    issues.push("Consider providing more detail");
    score -= 10;
  }

  // Check for all caps
  if (text === text.toUpperCase() && text.length > 5 && /[A-Z]/.test(text)) {
    issues.push("Avoid using ALL CAPS as it may seem like shouting");
    score -= 15;
  }

  // Check for excessive punctuation
  const exclamationCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;

  if (exclamationCount > 2) {
    issues.push("Too many exclamation marks can seem unprofessional");
    score -= 10;
  }

  // Check for vague words
  const vagueWords = [
    "thing",
    "stuff",
    "something",
    "anything",
    "whatever",
    "soon",
    "later",
  ];
  const foundVague = vagueWords.filter((w) => text.toLowerCase().includes(w));
  if (foundVague.length > 0) {
    issues.push(
      `Be more specific instead of using words like: ${foundVague.join(", ")}`,
    );
    score -= 15;
  }

  // Check for spelling (basic)
  const commonMisspellings = {
    teh: "the",
    adn: "and",
    taht: "that",
    wiht: "with",
    fro: "for",
    ot: "to",
    si: "is",
    ti: "it",
  };

  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  const spellingErrors = [];
  words.forEach((word) => {
    if (commonMisspellings[word]) {
      spellingErrors.push(`"${word}" should be "${commonMisspellings[word]}"`);
    }
  });

  if (spellingErrors.length > 0) {
    issues.push(`Spelling issues: ${spellingErrors.join("; ")}`);
    score -= spellingErrors.length * 5;
  }

  // Check readability
  const avgWordLength =
    words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1);
  if (avgWordLength > 8) {
    issues.push("Consider using simpler words for better clarity");
    score -= 5;
  }

  // Check sentence length
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgSentenceLength = wordCount / (sentences.length || 1);
  if (avgSentenceLength > 25) {
    issues.push("Sentences are quite long. Consider breaking them up.");
    score -= 10;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
    wordCount,
    readabilityScore: Math.max(
      0,
      Math.min(100, 100 - (avgWordLength - 4) * 10),
    ),
  };
};

// Generate suggestions
const generateSuggestions = (text, clarityIssues, tone) => {
  const suggestions = [];

  // Tone-based suggestions
  if (tone === "very_negative" || tone === "negative") {
    suggestions.push("Consider using more positive or neutral language");
    suggestions.push("Try to focus on solutions rather than problems");
  }

  if (tone === "urgent") {
    suggestions.push(
      "Your message sounds urgent. Make sure to clearly state the deadline or timeline",
    );
  }

  if (tone === "confused") {
    suggestions.push(
      "Try to be more specific about what you need clarification on",
    );
  }

  // Clarity-based suggestions
  if (clarityIssues.includes("short")) {
    suggestions.push(
      "Provide more context to help others understand your message",
    );
  }

  // Add general suggestions
  if (
    !text.match(
      /^(Hi|Hello|Hey|Good morning|Good afternoon|Good evening|Dear)/i,
    )
  ) {
    suggestions.push("Consider starting with a greeting for a friendlier tone");
  }

  if (!text.match(/(please|thank|thanks|appreciate)/i)) {
    suggestions.push(
      'Using polite words like "please" and "thank you" improves tone',
    );
  }

  if (text.length > 200 && !text.includes("\n") && !text.includes(". ")) {
    suggestions.push(
      "Break up long messages into paragraphs for better readability",
    );
  }

  return suggestions.slice(0, 4); // Return max 4 suggestions
};

// Detect potential misunderstandings
const detectMisunderstanding = (text, tone, clarityScore) => {
  const indicators = [];

  // Check for ambiguous words
  const ambiguousWords = ["it", "this", "that", "they", "them", "those"];
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  const ambiguousCount = words.filter((w) => ambiguousWords.includes(w)).length;

  if (ambiguousCount > 3) {
    indicators.push("Too many ambiguous pronouns (it, this, that)");
  }

  // Check for multiple questions
  const questionCount = (text.match(/\?/g) || []).length;
  if (questionCount > 2) {
    indicators.push("Multiple questions may lead to partial answers");
  }

  // Check for mixed signals
  if (tone === "confused") {
    indicators.push("Message indicates confusion");
  }

  // Low clarity
  if (clarityScore < 60) {
    indicators.push("Low clarity score");
  }

  return {
    potential: indicators.length > 0,
    indicators,
  };
};

// Generate improved version
const generateImprovedVersion = (text, issues) => {
  let improved = text;

  // Fix all caps
  if (text === text.toUpperCase() && text.length > 5) {
    improved = text.charAt(0) + text.slice(1).toLowerCase();
  }

  // Add greeting if missing
  if (
    !improved.match(/^(Hi|Hello|Hey|Good morning|Good afternoon|Good evening)/i)
  ) {
    improved = "Hi, " + improved.charAt(0).toLowerCase() + improved.slice(1);
  }

  return improved;
};

// Main analysis function
const analyzeMessage = async (content, messageId = null) => {
  try {
    // Run all analyses
    const tone = analyzeSentiment(content);
    const clarity = analyzeClarity(content);
    const suggestions = generateSuggestions(content, clarity.issues, tone);
    const misunderstanding = detectMisunderstanding(
      content,
      tone,
      clarity.score,
    );
    const improvedVersion = generateImprovedVersion(content, clarity.issues);

    const emotionMap = {
      very_positive: "happy",
      positive: "content",
      neutral: "neutral",
      negative: "frustrated",
      very_negative: "angry",
      confused: "confused",
      urgent: "anxious",
    };

    const analysis = {
      clarityScore: clarity.score,
      tone,
      emotionDetected: emotionMap[tone],
      grammarIssues: clarity.issues,
      suggestions,
      improvedVersion: improvedVersion !== content ? improvedVersion : null,
      potentialMisunderstanding: misunderstanding.potential,
      misunderstandingReason: misunderstanding.indicators.join("; "),
      wordCount: clarity.wordCount,
      readabilityScore: clarity.readabilityScore,
    };

    // Save to database if messageId provided
    if (messageId) {
      await db.insert(
        `INSERT INTO message_analysis 
         (message_id, clarity_score, tone, emotion_detected, grammar_issues, 
          suggestions, improved_version, potential_misunderstanding, 
          misunderstanding_reason, word_count, readability_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         clarity_score = VALUES(clarity_score),
         tone = VALUES(tone),
         emotion_detected = VALUES(emotion_detected),
         grammar_issues = VALUES(grammar_issues),
         suggestions = VALUES(suggestions),
         improved_version = VALUES(improved_version),
         potential_misunderstanding = VALUES(potential_misunderstanding),
         misunderstanding_reason = VALUES(misunderstanding_reason),
         word_count = VALUES(word_count),
         readability_score = VALUES(readability_score)`,
        [
          messageId,
          analysis.clarityScore,
          analysis.tone,
          analysis.emotionDetected,
          JSON.stringify(analysis.grammarIssues),
          JSON.stringify(analysis.suggestions),
          analysis.improvedVersion,
          analysis.potentialMisunderstanding,
          analysis.misunderstandingReason,
          analysis.wordCount,
          analysis.readabilityScore,
        ],
      );
    }

    return analysis;
  } catch (error) {
    console.error("Message analysis error:", error);
    return {
      clarityScore: 50,
      tone: "neutral",
      emotionDetected: "neutral",
      grammarIssues: [],
      suggestions: [],
      improvedVersion: null,
      potentialMisunderstanding: false,
      wordCount: content.split(/\s+/).length,
      readabilityScore: 50,
    };
  }
};

// Generate personalized suggestions for user
const generateUserSuggestions = async (userId) => {
  try {
    // Get user's recent message stats
    const stats = await db.getOne(
      `SELECT 
        AVG(ma.clarity_score) as avg_clarity,
        COUNT(CASE WHEN ma.tone IN ('negative', 'very_negative') THEN 1 END) as negative_count,
        COUNT(CASE WHEN ma.potential_misunderstanding = TRUE THEN 1 END) as misunderstanding_count,
        AVG(LENGTH(m.content)) as avg_length
       FROM messages m
       JOIN message_analysis ma ON m.id = ma.message_id
       WHERE m.sender_id = ?
       AND m.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [userId],
    );

    const suggestions = [];

    if (stats.avg_clarity < 70) {
      suggestions.push({
        category: "clarity",
        title: "Improve Message Clarity",
        description:
          'Your messages could be clearer. Try to be more specific and avoid vague words like "thing" or "stuff".',
        action: "Practice writing detailed messages",
      });
    }

    if (stats.negative_count > 5) {
      suggestions.push({
        category: "tone",
        title: "Use More Positive Language",
        description:
          "Several of your recent messages had a negative tone. Try to frame feedback constructively.",
        action: "Focus on solutions, not just problems",
      });
    }

    if (stats.misunderstanding_count > 3) {
      suggestions.push({
        category: "clarity",
        title: "Avoid Ambiguity",
        description:
          "Some of your messages may have been misunderstood. Be clear about what you're referring to.",
        action: 'Use specific nouns instead of "it" or "this"',
      });
    }

    if (stats.avg_length < 20) {
      suggestions.push({
        category: "engagement",
        title: "Provide More Context",
        description:
          "Your messages are quite short. Adding more context helps others understand better.",
        action: "Include relevant details in your messages",
      });
    }

    // Add general suggestions
    if (suggestions.length < 3) {
      suggestions.push({
        category: "general",
        title: "Use Polite Language",
        description:
          'Words like "please" and "thank you" make communication more effective.',
        action: 'Start requests with "Please"',
      });
    }

    return suggestions;
  } catch (error) {
    console.error("Generate suggestions error:", error);
    return [];
  }
};

// Update user's aggregate communication score
const updateUserCommunicationScore = async (userId) => {
  try {
    // 1. Get average scores from all user's analyzed messages
    const stats = await db.getOne(
      `SELECT 
        AVG(ma.clarity_score) as avg_clarity,
        AVG(ma.readability_score) as avg_readability,
        COUNT(m.id) as total_messages,
        COUNT(CASE WHEN ma.tone IN ('positive', 'very_positive') THEN 1 END) as positive_count,
        COUNT(CASE WHEN ma.tone IN ('negative', 'very_negative') THEN 1 END) as negative_count,
        AVG(ma.word_count) as avg_word_length
       FROM messages m
       JOIN message_analysis ma ON m.id = ma.message_id
       WHERE m.sender_id = ? AND m.is_deleted = FALSE`,
      [userId],
    );

    if (!stats || stats.total_messages === 0) return;

    // Calculate tone score (percentage of non-negative messages)
    const totalAnalyzed =
      stats.positive_count +
      stats.negative_count +
      (stats.total_messages - stats.positive_count - stats.negative_count); // This is just total_messages
    const toneScore =
      stats.total_messages > 0
        ? ((stats.total_messages - stats.negative_count) /
            stats.total_messages) *
          100
        : 0;

    // Overall score is weighted average of clarity and tone
    const overallScore = parseFloat(stats.avg_clarity) * 0.6 + toneScore * 0.4;

    // 2. Update users table
    await db.update(
      `UPDATE users SET 
        communication_score = ?, 
        clarity_score = ?, 
        tone_score = ?, 
        total_messages_sent = ?
       WHERE id = ?`,
      [
        Math.round(overallScore),
        stats.avg_clarity,
        toneScore,
        stats.total_messages,
        userId,
      ],
    );

    // 3. Update communication_scores table for today
    // Check if entry exists for today
    const todayScore = await db.getOne(
      "SELECT id FROM communication_scores WHERE user_id = ? AND date = CURDATE()",
      [userId],
    );

    if (todayScore) {
      await db.update(
        `UPDATE communication_scores SET 
          overall_score = ?,
          clarity_score = ?,
          tone_score = ?,
          messages_sent = ?,
          messages_analyzed = ?,
          avg_message_length = ?,
          positive_tone_percentage = ?,
          negative_tone_percentage = ?,
          updated_at = NOW()
         WHERE id = ?`,
        [
          overallScore,
          stats.avg_clarity,
          toneScore,
          stats.total_messages,
          stats.total_messages,
          stats.avg_word_length,
          (stats.positive_count / stats.total_messages) * 100,
          (stats.negative_count / stats.total_messages) * 100,
          todayScore.id,
        ],
      );
    } else {
      await db.insert(
        `INSERT INTO communication_scores 
         (user_id, date, overall_score, clarity_score, tone_score, messages_sent, messages_analyzed, 
          avg_message_length, positive_tone_percentage, negative_tone_percentage)
         VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          overallScore,
          stats.avg_clarity,
          toneScore,
          stats.total_messages,
          stats.total_messages,
          stats.avg_word_length,
          (stats.positive_count / stats.total_messages) * 100,
          (stats.negative_count / stats.total_messages) * 100,
        ],
      );
    }
  } catch (error) {
    console.error("Update user communication score error:", error);
  }
};

module.exports = {
  analyzeMessage,
  generateSuggestions: generateUserSuggestions,
  updateUserCommunicationScore,
};
