"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AvatarStack } from "./ui";
import { dueTone, formatDate, isDoneColumn } from "../lib/format";

function SortableTask({ task, project, canEdit, onOpen, onMove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task:${task._id}`,
    disabled: !canEdit,
    data: { type: "task", taskId: String(task._id), columnId: task.columnId },
  });
  const done = isDoneColumn(project, task.columnId);
  const tone = dueTone(task.dueDate, done);
  const checkTotal = task.checklist?.length || 0;
  const checkDone = task.checklist?.filter((item) => item.done).length || 0;

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={`task prio-${task.priority || "medium"} ${done ? "is-done" : ""}`}
      onClick={() => onOpen(task._id)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") onOpen(task._id);
      }}
    >
      <div className="task-top">
        <h4>{task.title}</h4>
        <span className={`prio-tag ${task.priority || "medium"}`}>{task.priority || "medium"}</span>
        {canEdit && (
          <button
            type="button"
            className="task-drag-handle"
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Drag ${task.title}`}
            title="Drag to reorder or move"
          >
            <span aria-hidden="true">⠿</span>
          </button>
        )}
      </div>
      {task.labels?.length > 0 && (
        <div>
          {task.labels.map((label) => <span className="chip" key={label}>{label}</span>)}
        </div>
      )}
      <div className="task-meta">
        {task.dueDate && <span className={`due ${tone}`}>{formatDate(task.dueDate)}</span>}
        {checkTotal > 0 && <span className="muted">☑ {checkDone}/{checkTotal}</span>}
        {task.comments?.length > 0 && <span className="muted">💬 {task.comments.length}</span>}
        {task.sprint?.name && <span className="chip">{task.sprint.name}</span>}
        <span className="grow" />
        <AvatarStack users={task.assignees || []} />
      </div>
      {canEdit && (
        <select
          className="move-select"
          value={task.columnId}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onMove(task._id, event.target.value)}
          aria-label={`Move ${task.title}`}
        >
          {project.columns.map((column) => (
            <option key={column.id} value={column.id}>Move to: {column.title}</option>
          ))}
        </select>
      )}
    </article>
  );
}

function BoardColumn({ column, tasks, project, filtering, canEdit, onOpen, onMove }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { type: "column", columnId: column.id },
  });

  return (
    <section
      ref={setNodeRef}
      className={`column ${isOver ? "drag-over" : ""}`}
      aria-label={column.title}
    >
      <h3>
        {column.title}
        <span className="count">{tasks.length}</span>
      </h3>
      <SortableContext items={tasks.map((task) => `task:${task._id}`)} strategy={verticalListSortingStrategy}>
        {tasks.length === 0 && <div className="empty">{filtering ? "No matches." : "Nothing here."}</div>}
        {tasks.map((task) => (
          <SortableTask
            key={task._id}
            task={task}
            project={project}
            canEdit={canEdit}
            onOpen={onOpen}
            onMove={onMove}
          />
        ))}
      </SortableContext>
    </section>
  );
}

export default function ProjectKanban({ project, tasks, filtering, canEdit, onOpen, onMove, onDrop }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function finishDrag({ active, over }) {
    if (!over) return;
    const activeData = active.data.current;
    const overData = over.data.current;
    if (!activeData?.taskId || !overData) return;
    onDrop({
      taskId: activeData.taskId,
      targetColumnId: overData.columnId,
      targetTaskId: overData.type === "task" ? overData.taskId : null,
      filtering,
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={finishDrag}>
      <div className="kanban" style={{ "--cols": project.columns.length }}>
        {[...project.columns]
          .sort((a, b) => a.order - b.order)
          .map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              tasks={tasks.filter((task) => task.columnId === column.id).sort((a, b) => a.order - b.order)}
              project={project}
              filtering={filtering}
              canEdit={canEdit}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))}
      </div>
    </DndContext>
  );
}
