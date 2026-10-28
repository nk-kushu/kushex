# Idea: tree conversations from selected text

Status: proposed. This document describes a product idea and an implementation
plan; it does not describe an implemented feature.

## The idea in simple words

Let the user explore an explanation like a tree. They can select part of an
agent's answer, ask a question about it, and open a new chat that already knows
the relevant context from the original chat.

The original conversation stays available. The user can go deeper in the new
chat, branch again from one of its answers, or return to any earlier conversation.

## Example

1. The user asks: “Explain how a tool call works from start to end.”
2. The agent explains validation, execution, result storage, and retries.
3. The user selects “the journal prevents duplicate tool execution.”
4. They choose **Ask about selection** and type: “How does it know this is the
   same operation?”
5. A child chat opens with the selected text, the question, and context from the
   parent chat. The agent answers without asking the user to explain everything again.
6. The user selects “operation ID” in this new answer and asks another question,
   creating a deeper child chat.
7. They return to the original explanation and open another branch about retries.

```text
Tool calls: start to end
├── How does the journal recognize the same operation?
│   └── Who creates the operation ID?
└── What happens when a tool fails?
```

Each node is a normal conversation with its own message history. A branch is a
focused follow-up conversation, and a conversation can have many children.

## User experience

- Selecting text in a completed agent message reveals **Ask about selection**.
- A small composer shows the selected quote and lets the user enter a question.
  Selecting text alone does not create a chat or start an agent run.
- Submitting creates the child chat and opens it. The selected quote and a link
  to its source appear above the question so the user can see what it refers to.
- A collapsible tree shows the root conversation and its branches. The active
  conversation is highlighted. Short titles come from the user's question and
  can be renamed.
- Breadcrumbs show the path back to the root. Choosing a parent restores its
  scroll position; following the source link scrolls to the quoted message.
- Returning to a conversation allows the user to continue it normally. Existing
  children remain attached to the message they were created from.
- Provide an accessible message action that lets the user choose or enter a
  quote without relying on a mouse selection. On mobile, show the tree in a drawer.

## What context the child receives

The child needs enough context to understand the question even when the selected
text contains phrases such as “this operation” or “the previous step.”

At branch creation, save a fixed context snapshot containing:

1. The exact selected text and its complete source message.
2. The conversation history leading to that message, including the original
   request and any context inherited by the parent.
3. Relevant references already present in that history, such as file paths,
   code excerpts, and tool results, within the context size limit.
4. The new question, clearly identified as the user's current request.

Later messages in the parent do not silently change an existing child's context.
Sibling conversations are excluded. A deeper branch inherits its ancestor context
and its own path through the tree, without including unrelated branches.

For long histories, keep the quote, source message, and new question intact;
summarize older history to fit the model's context budget. Store which messages
were included or summarized so the context can be inspected and debugged.
Inherited text is conversation context, not a new system instruction.

A branch uses the same project and workspace as its parent. It follows current
access and tool permissions; quoted content does not grant extra permissions.
The context snapshot preserves the conversation, not a historical copy of the
workspace files. Fresh code inspection may therefore find newer file contents.

## Proposed data model

These are conceptual records; align their final names with the chat implementation.

| Record | Main fields | Purpose |
| --- | --- | --- |
| Conversation | `id`, `rootConversationId`, `parentConversationId`, `title`, project/workspace scope | Represents one node and its place in the tree; the root has no parent |
| Branch source | `childConversationId`, `sourceMessageId`, message version, `selectedText`, text offsets | Records where the branch began and lets the UI locate the quote |
| Context snapshot | `id`, `childConversationId`, ancestor message references, preserved content, summary, creation time | Freezes the context used to start the child |
| Message | Existing message fields plus its conversation ID | Keeps each conversation's messages separate |

Store the quote itself as well as its location. Offsets alone are fragile when
rendering Markdown or when a message changes. Anchor selections to the stored
message version and a defined text representation, including selections that
cross formatting or code blocks.

## Proposed application flow

1. The UI captures a quote from a completed agent message and collects a question.
2. The server validates access to the parent and source message, verifies the
   selection against that message version, and builds the context snapshot.
3. The server saves the child conversation, branch source, snapshot, and first
   user question together, then starts the agent using that context.
4. The UI opens the child and receives its response through the chat's normal
   response mechanism. Tree navigation does not cancel a running response.
5. The server exposes tree metadata and source links so branches survive reloads
   and can be opened directly by URL.

Branch creation should accept a request ID. Retrying the same submission returns
the same child rather than creating duplicate branches. If response generation
fails after creation, keep the child and question available for retry.

## Implementation plan

### Phase 1: one complete branching flow

- Add persistent parent/root links, branch source records, and context snapshots.
- Add a server operation to create a child from a quote and question, with access
  checks and duplicate-request handling.
- Add the selection action, question composer, quoted source, and parent link.
- Run the agent in the child using the saved context and existing chat behavior.
- Support branching from a child immediately, so the feature supports arbitrary
  depth from the first version.

Acceptance: the user can ask for an explanation, branch from a selected passage,
receive a context-aware answer, branch again, and return to the unchanged parent.

### Phase 2: navigation and context limits

- Add the collapsible conversation tree, breadcrumbs, titles, and direct URLs.
- Restore scroll positions and jump back to source quotes.
- Add context size limits and summaries for long ancestor histories.
- Cover formatted text, code blocks, keyboard access, and mobile selection.

Acceptance: multiple sibling branches and deeper branches are easy to navigate,
remain available after reload, and use only their own ancestor context.

### Phase 3: refine after real use

- Let the user inspect the inherited context and understand when it was summarized.
- Consider searching branches and marking questions as resolved.
- Decide how archiving or deleting a parent affects its descendants before adding
  those actions. Preserve source/context integrity and avoid orphaned branches.
- Consider explicitly bringing a useful child answer back into the parent as a
  linked summary. Keep this a user action so exploration does not alter the parent.

## Verification scenarios

- A question about “this operation” is answered correctly using the parent context.
- Two questions from the same passage create independent sibling conversations.
- A grandchild receives its ancestor context without receiving a sibling's history.
- Continuing the parent leaves an existing child's saved context unchanged.
- Retrying branch creation creates one child; retrying a failed response uses it.
- Reloading restores the tree, active chat, source quote, and messages.
- Invalid selections, inaccessible source messages, and scope mismatches are rejected.
- A long conversation fits the context budget while preserving the selected quote
  and question; a quote that cannot fit produces a clear, recoverable message.

## Initial scope

Start with user-created branches from completed agent answers, persistent tree
navigation, and inherited context. Automatic agent-created branches, merging
conversation histories, and parallel code-editing workspaces can be considered
later as separate ideas.
