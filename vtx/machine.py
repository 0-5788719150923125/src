from apscheduler.schedulers.asyncio import AsyncIOScheduler
import threading
import asyncio
import time
from utils import config
import head
import lab

scheduler = AsyncIOScheduler()
scheduler.add_job(head.loader, "interval", minutes=30)
scheduler.start()

tasks = {}

# This is the main loop for the entire machine
@asyncio.coroutine
async def main(loop):

    while True:
        try:

            # Load the AI model at startup
            if head.ai is None:
                head.ai = await head.loader()

            # Prune completed tasks
            for task in tasks.copy():
                if tasks[task].done() or tasks[task].cancelled():
                    del tasks[task]

            # Get configs, create tasks, and append to task queue
            if "source" in config:
                for channel in config["source"]:
                    if "watch" in config["source"][channel]:
                        if config["source"][channel]["watch"] == True:
                            if "source-" + channel not in tasks:
                                task = loop.create_task(lab.source.subscribe(channel))
                                task.set_name("source-" + channel)
                                tasks[task.get_name()] = task

            if "telegram" in config:
                if "telegram" not in tasks:
                    task = loop.create_task(lab.telegram.subscribe())
                    task.set_name("telegram")
                    tasks[task.get_name()] = task

            if "reddit" in config:
                for subreddit in config["reddit"]:
                    if "watch" in config["reddit"][subreddit]:
                        if config["reddit"][subreddit]["watch"] == True:
                            if "reddit-" + subreddit not in tasks:
                                task = loop.create_task(lab.reddit.subscribe(subreddit))
                                task.set_name("reddit-" + subreddit)
                                tasks[task.get_name()] = task

            if "discord" in config:
                if "discord" not in tasks:
                    task = loop.create_task(lab.discord.subscribe())
                    task.set_name("discord")
                    tasks[task.get_name()] = task
        except:
            pass

        await asyncio.sleep(66.6666)


def loop_in_thread(loop):
    asyncio.set_event_loop(loop)
    loop.run_until_complete(main(loop))


# Start the main loop in a thread
loop = asyncio.get_event_loop()
t = threading.Thread(None, loop_in_thread, args=(loop,), daemon=True)

while True:
    time.sleep(5)
    if not t.is_alive():
        t.start()
