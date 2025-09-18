#!/bin/bash

# 📊 Multi-Claude Agent Status Monitor
# Checks the status of all agent worktrees and provides a unified dashboard

echo "🎯 Multi-Claude Agent Status Dashboard"
echo "======================================"
echo ""

WORKTREE_BASE="../claude-sessions"

if [ ! -d "$WORKTREE_BASE" ]; then
    echo "❌ Worktrees not found. Run ./scripts/setup-worktrees.sh first"
    exit 1
fi

AGENTS="claude-1-api:API & OpenRouter
claude-2-database:Database & Storage
claude-3-extraction:Sefaria Extraction
claude-4-chunking:Chunking & Embeddings
claude-5-frontend:Frontend & UI
claude-6-voice:Voice & Audio
claude-7-testing:Testing & QA
claude-8-deployment:Deployment & Ops"

echo "🔍 Scanning agent statuses..."
echo ""

total_agents=0
active_agents=0
completed_tasks=0
total_tasks=0

echo "$AGENTS" | while IFS=':' read -r agent description; do
    agent_dir="$WORKTREE_BASE/$agent"

    if [ -d "$agent_dir" ]; then
        ((total_agents++))

        echo "📋 $agent - $description"
        echo "   Directory: $agent_dir"

        # Check if agent has recent commits
        cd "$agent_dir"
        last_commit=$(git log -1 --format="%h %s" 2>/dev/null || echo "No commits")
        echo "   Last Commit: $last_commit"

        # Check status file
        if [ -f "STATUS.md" ]; then
            # Count completed tasks
            completed=$(grep -c "- \[x\]" STATUS.md 2>/dev/null || echo 0)
            pending=$(grep -c "- \[ \]" STATUS.md 2>/dev/null || echo 0)

            ((completed_tasks += completed))
            ((total_tasks += completed + pending))

            echo "   Tasks: $completed completed, $pending pending"

            # Check for recent activity
            if [ $(find STATUS.md -mtime -1 2>/dev/null | wc -l) -gt 0 ]; then
                echo "   Status: 🟢 Recently active"
                ((active_agents++))
            else
                echo "   Status: 🟡 Inactive"
            fi
        else
            echo "   Status: ❌ No status file"
        fi

        # Check for test results
        if [ -f "test-results.json" ]; then
            test_status=$(cat test-results.json | grep '"passed"' | cut -d':' -f2 | tr -d ' ,')
            echo "   Tests: $test_status"
        fi

        echo ""
        cd - > /dev/null
    fi
done

echo "📊 Summary Dashboard:"
echo "===================="
echo "👥 Total Agents: $total_agents"
echo "🟢 Active Agents: $active_agents"
echo "📋 Tasks Completed: $completed_tasks/$total_tasks"

if [ $total_tasks -gt 0 ]; then
    completion_rate=$((completed_tasks * 100 / total_tasks))
    echo "📈 Completion Rate: $completion_rate%"
fi

echo ""
echo "🔄 Git Status Summary:"
echo "====================="

# Check main branch status
cd "$(dirname "$0")/.."
main_commits=$(git rev-list --count HEAD)
echo "📌 Main Branch: $main_commits commits"

# Check for unmerged branches
unmerged_branches=$(git branch --no-merged main | grep -v "^\*" | wc -l)
echo "🔀 Unmerged Branches: $unmerged_branches"

echo ""
echo "🚀 Quick Actions:"
echo "================="
echo "• Pull all updates: bash scripts/sync-all-agents.sh"
echo "• Run all tests: bash scripts/test-all-agents.sh"
echo "• Merge all ready: bash scripts/merge-ready-agents.sh"
echo "• Deploy to production: bash scripts/deploy-production.sh"

# Check if server is running
if pgrep -f "node server.js" > /dev/null; then
    echo "🟢 Application Server: Running"
else
    echo "🔴 Application Server: Stopped"
fi

# Check database connection
if psql -d rabbi_nachman_db -c "SELECT 1;" > /dev/null 2>&1; then
    echo "🟢 Database: Connected"
else
    echo "🔴 Database: Disconnected"
fi