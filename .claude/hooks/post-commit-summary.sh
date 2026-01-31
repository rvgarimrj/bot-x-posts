#!/bin/bash
# Hook: Adiciona resumo do commit ao CLAUDE.md
# Executado apos cada commit bem-sucedido

CLAUDE_MD="/Users/user/AppsCalude/Bot-X-Posts/.claude/CLAUDE.md"
DATE=$(date "+%Y-%m-%d %H:%M")
COMMIT_HASH=$(git rev-parse --short HEAD)
COMMIT_MSG=$(git log -1 --pretty=%s)
FILES_CHANGED=$(git diff-tree --no-commit-id --name-only -r HEAD | head -5 | tr '\n' ', ' | sed 's/,$//')

# Verifica se a secao de historico existe, senao cria
if ! grep -q "## Historico de Commits" "$CLAUDE_MD"; then
  echo -e "\n## Historico de Commits\n" >> "$CLAUDE_MD"
fi

# Adiciona entrada no historico (no inicio da secao)
ENTRY="- **${DATE}** [\`${COMMIT_HASH}\`] ${COMMIT_MSG} (${FILES_CHANGED})"

# Usa sed para inserir apos a linha "## Historico de Commits"
sed -i '' "/## Historico de Commits/a\\
${ENTRY}
" "$CLAUDE_MD"

echo "CLAUDE.md atualizado com commit ${COMMIT_HASH}"
