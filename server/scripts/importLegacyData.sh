#!/usr/bin/env bash
# Import a legacy mysqldump (old schema, no User table) into the current
# word_app database, attributing every row to user "zyd".
#
# Usage:
#   ./importLegacyData.sh <path-to-old-dump.sql>
#
# Assumptions:
#   - Current `word_app` is on the latest schema (User table exists, zyd seeded).
#   - Old dump was produced with `mysqldump -u root -p word_app` (no --databases).
#   - MySQL credentials are read from server/.env via DATABASE_URL.

set -euo pipefail

DUMP_PATH="${1:-}"
if [[ -z "$DUMP_PATH" ]]; then
  echo "Usage: $0 <path-to-old-dump.sql>" >&2
  exit 1
fi
if [[ ! -f "$DUMP_PATH" ]]; then
  echo "Dump file not found: $DUMP_PATH" >&2
  exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ENV_FILE="$SCRIPT_DIR/../.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Cannot find $ENV_FILE" >&2
  exit 1
fi

# Parse mysql://user:pass@host:port/db from DATABASE_URL
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL not set in $ENV_FILE" >&2
  exit 1
fi

DB_USER=$(echo "$DATABASE_URL" | sed -E 's|^mysql://([^:]+):.*|\1|')
DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|^mysql://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|^mysql://[^:]+:[^@]+@([^:]+):.*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|^mysql://[^:]+:[^@]+@[^:]+:([0-9]+)/.*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|^mysql://[^:]+:[^@]+@[^:]+:[0-9]+/([^?]+).*|\1|')

if command -v mysql >/dev/null 2>&1; then
  MYSQL_BIN="mysql"
elif [[ -x /usr/local/mysql/bin/mysql ]]; then
  MYSQL_BIN="/usr/local/mysql/bin/mysql"
else
  echo "mysql binary not found" >&2
  exit 1
fi

OLD_DB="${DB_NAME}_legacy_import"
ZYD_ID='00000000-0000-0000-0000-000000000001'

mysql_run() {
  "$MYSQL_BIN" --protocol=TCP -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$@"
}

echo "==> Verifying zyd user exists in $DB_NAME"
mysql_run "$DB_NAME" -N -e "SELECT id FROM User WHERE id='$ZYD_ID' LIMIT 1;" | grep -q "$ZYD_ID" || {
  echo "User zyd not found in $DB_NAME — run prisma migrate first." >&2
  exit 1
}

echo "==> (Re)creating temp database $OLD_DB"
mysql_run -e "DROP DATABASE IF EXISTS \`$OLD_DB\`; CREATE DATABASE \`$OLD_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "==> Importing dump into $OLD_DB"
mysql_run "$OLD_DB" < "$DUMP_PATH"

echo "==> Confirming source tables present"
for t in Folder Word Note Review ExpressionFolder Expression AiUsageLog; do
  exists=$(mysql_run -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$OLD_DB' AND table_name='$t';")
  echo "    $t: ${exists}"
done

echo "==> Copying rows into $DB_NAME and tagging with zyd"
mysql_run "$DB_NAME" <<SQL
SET FOREIGN_KEY_CHECKS = 0;

INSERT IGNORE INTO Folder (id, name, language, userId)
  SELECT id, name, language, '$ZYD_ID' FROM \`$OLD_DB\`.Folder;

INSERT IGNORE INTO Note (id, title, content, course, lesson, createdAt, userId)
  SELECT id, title, content,
         COALESCE(course, ''),
         COALESCE(lesson, ''),
         createdAt, '$ZYD_ID'
  FROM \`$OLD_DB\`.Note;

INSERT IGNORE INTO ExpressionFolder (id, name, language, createdAt, userId)
  SELECT id, name, language, createdAt, '$ZYD_ID' FROM \`$OLD_DB\`.ExpressionFolder;

INSERT IGNORE INTO Word (id, word, reading, meaning, example, note, partOfSpeech,
                         language, folderId, sourceNoteId, createdAt)
  SELECT id, word, reading, meaning, example, note,
         COALESCE(partOfSpeech, ''),
         language, folderId, sourceNoteId, createdAt
  FROM \`$OLD_DB\`.Word;

INSERT IGNORE INTO Review (id, wordId, \`interval\`, repetition, easeFactor, difficultyScore,
                           lastRating, recentRatings, firstLearnedAt, nextReviewDate, lastReviewedAt)
  SELECT id, wordId, \`interval\`, repetition, easeFactor,
         COALESCE(difficultyScore, 0),
         COALESCE(lastRating, ''),
         COALESCE(recentRatings, ''),
         firstLearnedAt, nextReviewDate, lastReviewedAt
  FROM \`$OLD_DB\`.Review;

INSERT IGNORE INTO Expression (id, zhText, enCasual, jpCasual, sceneTag, note,
                               isMastered, folderId, createdAt, updatedAt)
  SELECT id, zhText, enCasual, jpCasual,
         COALESCE(sceneTag, ''),
         note,
         COALESCE(isMastered, 0),
         folderId, createdAt, updatedAt
  FROM \`$OLD_DB\`.Expression;

INSERT IGNORE INTO AiUsageLog (id, word, language, model, feature, promptTokens,
                               completionTokens, totalTokens, createdAt, userId)
  SELECT id, word, language, model,
         COALESCE(feature, 'other'),
         promptTokens, completionTokens, totalTokens, createdAt, '$ZYD_ID'
  FROM \`$OLD_DB\`.AiUsageLog;

SET FOREIGN_KEY_CHECKS = 1;
SQL

echo "==> Final counts in $DB_NAME"
mysql_run "$DB_NAME" -e "
  SELECT 'Folder' AS t, COUNT(*) AS c FROM Folder
  UNION ALL SELECT 'Word', COUNT(*) FROM Word
  UNION ALL SELECT 'Note', COUNT(*) FROM Note
  UNION ALL SELECT 'Review', COUNT(*) FROM Review
  UNION ALL SELECT 'ExpressionFolder', COUNT(*) FROM ExpressionFolder
  UNION ALL SELECT 'Expression', COUNT(*) FROM Expression
  UNION ALL SELECT 'AiUsageLog', COUNT(*) FROM AiUsageLog;"

echo
echo "Done. Temp DB $OLD_DB kept for inspection — drop with:"
echo "  $MYSQL_BIN --protocol=TCP -h $DB_HOST -P $DB_PORT -u $DB_USER -p'***' -e 'DROP DATABASE \`$OLD_DB\`;'"
