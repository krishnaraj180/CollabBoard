"use client";

import { formatDate, isDoneColumn } from "../lib/format";

const DAY = 24 * 60 * 60 * 1000;
const ROW_HEIGHT = 56;
const DAY_WIDTH = 24;
const LABEL_WIDTH = 240;

function dayStart(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function shortDate(value) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ProjectTimeline({ project, tasks, milestones }) {
  const scheduledTasks = tasks.map((task) => {
    const start = task.startDate || task.dueDate;
    const end = task.dueDate || task.startDate;
    return start && end ? { ...task, timelineStart: dayStart(start), timelineEnd: dayStart(end) } : task;
  }).filter((task) => task.timelineStart !== undefined);
  const unscheduledTasks = tasks.filter((task) => !task.startDate && !task.dueDate);
  const datedMilestones = milestones.filter((milestone) => milestone.dueDate);
  const dates = [
    ...scheduledTasks.flatMap((task) => [task.timelineStart, task.timelineEnd]),
    ...datedMilestones.map((milestone) => dayStart(milestone.dueDate)),
  ];

  if (!dates.length) {
    return (
      <section className="timeline-panel">
        <div className="empty">
          Add task start dates and deadlines or milestone deadlines to populate the project timeline.
        </div>
        {unscheduledTasks.length > 0 && (
          <div className="unscheduled-tasks">
            <h3>Unscheduled tasks</h3>
            <ul>{unscheduledTasks.map((task) => <li key={task._id}>{task.title}</li>)}</ul>
          </div>
        )}
      </section>
    );
  }

  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dayCount = Math.max(1, Math.ceil((maxDate - minDate) / DAY) + 1);
  const trackWidth = Math.max(dayCount * DAY_WIDTH, 720);
  const trackHeight = Math.max(ROW_HEIGHT, scheduledTasks.length * ROW_HEIGHT);
  const ticks = Array.from({ length: Math.ceil(dayCount / 7) + 1 }, (_, index) => {
    const date = minDate + index * 7 * DAY;
    return { date, left: (date - minDate) / DAY * DAY_WIDTH };
  }).filter((tick) => tick.left <= trackWidth);

  const bars = new Map(scheduledTasks.map((task) => {
    const left = (task.timelineStart - minDate) / DAY * DAY_WIDTH;
    const width = Math.max(DAY_WIDTH, (task.timelineEnd - task.timelineStart) / DAY * DAY_WIDTH + DAY_WIDTH);
    return [String(task._id), { left, width: Math.min(width, trackWidth - left) }];
  }));
  const taskIndexes = new Map(scheduledTasks.map((task, index) => [String(task._id), index]));
  const progressFor = (task) => {
    if (isDoneColumn(project, task.columnId)) return 100;
    return Math.max(0, Math.min(100, Number(task.progress) || 0));
  };

  return (
    <section className="timeline-panel">
      <div className="timeline-legend" aria-label="Timeline legend">
        <span><i className="gantt-legend-task" /> Task duration</span>
        <span><i className="gantt-legend-progress" /> Progress</span>
        <span><i className="gantt-legend-milestone" /> Milestone</span>
        <span><i className="gantt-legend-dependency" /> Dependency</span>
      </div>
      <div className="gantt-scroll">
        <div className="gantt-sheet" style={{ width: `${LABEL_WIDTH + trackWidth}px` }}>
          <div className="gantt-header">
            <div className="gantt-task-heading">Task · duration · progress</div>
            <div className="gantt-scale" style={{ width: `${trackWidth}px` }}>
              {ticks.map((tick) => (
                <span key={tick.date} style={{ left: `${tick.left}px` }}>{shortDate(tick.date)}</span>
              ))}
            </div>
          </div>
          <div className="gantt-body">
            <div className="gantt-labels" style={{ width: `${LABEL_WIDTH}px` }}>
              {scheduledTasks.map((task) => {
                const duration = Math.max(1, Math.ceil((task.timelineEnd - task.timelineStart) / DAY) + 1);
                return (
                  <div className="gantt-label-row" key={task._id} style={{ height: `${ROW_HEIGHT}px` }}>
                    <strong title={task.title}>{task.title}</strong>
                    <span>{duration} day{duration === 1 ? "" : "s"} · {progressFor(task)}%</span>
                  </div>
                );
              })}
            </div>
            <div className="gantt-track" style={{ width: `${trackWidth}px`, height: `${trackHeight}px` }}>
              {ticks.map((tick) => (
                <i className="gantt-grid-line" key={tick.date} style={{ left: `${tick.left}px` }} aria-hidden="true" />
              ))}
              <svg
                className="gantt-connections"
                width={trackWidth}
                height={trackHeight}
                viewBox={`0 0 ${trackWidth} ${trackHeight}`}
                aria-hidden="true"
              >
                <defs>
                  <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" />
                  </marker>
                </defs>
                {scheduledTasks.flatMap((task, index) =>
                  (task.dependencies || []).map((dependency) => {
                    const dependencyId = String(dependency?._id || dependency);
                    const dependencyIndex = taskIndexes.get(dependencyId);
                    const from = bars.get(dependencyId);
                    const to = bars.get(String(task._id));
                    if (dependencyIndex === undefined || !from || !to) return null;
                    const x1 = from.left + from.width;
                    const x2 = to.left;
                    const y1 = dependencyIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const y2 = index * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const middle = x1 + (x2 - x1) / 2;
                    return <path key={`${dependencyId}-${task._id}`} d={`M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`} markerEnd="url(#gantt-arrow)" />;
                  })
                )}
              </svg>
              {datedMilestones.map((milestone) => {
                const left = (dayStart(milestone.dueDate) - minDate) / DAY * DAY_WIDTH;
                return (
                  <div
                    className={`gantt-milestone-marker ${milestone.completedAt ? "complete" : ""}`}
                    key={milestone._id}
                    style={{ left: `${left}px`, height: `${trackHeight}px` }}
                    title={`${milestone.title} · ${formatDate(milestone.dueDate)}`}
                  >
                    <span aria-hidden="true" />
                  </div>
                );
              })}
              {scheduledTasks.map((task) => {
                const index = taskIndexes.get(String(task._id));
                const position = bars.get(String(task._id));
                const progress = progressFor(task);
                return (
                  <div
                    className={`gantt-bar ${isDoneColumn(project, task.columnId) ? "done" : ""}`}
                    key={task._id}
                    style={{
                      left: `${position.left}px`,
                      top: `${index * ROW_HEIGHT + 16}px`,
                      width: `${position.width}px`,
                    }}
                    title={`${task.title}: ${formatDate(task.startDate || task.dueDate)} – ${formatDate(task.dueDate || task.startDate)}, ${progress}%`}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {scheduledTasks.map((task) => (task.dependencies || []).length > 0 && (
        <p className="timeline-dependency-note" key={task._id}>
          <strong>{task.title}</strong> depends on {(task.dependencies || []).map((dependency) => dependency.title || "another task").join(", ")}.
        </p>
      ))}
      {unscheduledTasks.length > 0 && (
        <div className="unscheduled-tasks">
          <h3>Unscheduled tasks</h3>
          <ul>{unscheduledTasks.map((task) => <li key={task._id}>{task.title}</li>)}</ul>
        </div>
      )}
      {milestones.some((milestone) => !milestone.dueDate) && (
        <p className="muted">Some milestones have no deadline and are not placed on the timeline.</p>
      )}
    </section>
  );
}
