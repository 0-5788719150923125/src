import functools
import asyncio
import random
import typing
import time
import os
import re
import gc
from utils import ad, bc, config, propulsion, ship
from aitextgen import aitextgen
import requests

# holds the model globally
ai = None

os.environ["LRU_CACHE_CAPACITY"] = "1"

focus = os.environ["FOCUS"]

# Decorator to a blocking function into a background thread
def to_thread(func: typing.Callable) -> typing.Coroutine:
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        return await asyncio.to_thread(func, *args, **kwargs)

    return wrapper


# Load the specified model
@to_thread
def loader(target=None):

    try:
        del ai
        gc.collect()
    except:
        pass

    if target == None:
        target = focus

    model = config[target]

    if "training" in model:
        model_folder = "models/" + target
        tokenizer_file = "src." + target + ".tokenizer.json"
    else:
        tokenizer_file = "src." + target + ".tokenizer.json"
        model_folder = None

    print(bc.FOLD + "PEN@FOLD: " + ad.TEXT + model["info"])
    ai = aitextgen(
        model=model.get("model", None),
        model_folder=model_folder,
        tokenizer_file=None,
        to_gpu=model["to_gpu"],
        cache_dir="models",
    )
    print(bc.ROOT + "ONE@ROOT: " + ad.TEXT + str(ai))
    print(bc.FOLD + "PEN@FOLD: " + ad.TEXT + "focused on the " + target)
    return ai


# ping pang pong
context = [
    propulsion + "975174695399854150" + ship + " I am a robot.",
    propulsion + "1051994502333726841" + ship + " I am a ghost.",
    propulsion + "806051627198709760" + ship + " I am a human.",
    propulsion + "204716337971331072" + ship + " I am a medium.",
    propulsion + "855529761185857566" + ship + " I am an animal.",
]


# Build a local cache of global conversational state
def build_context(message):
    if len(context) >= 5:
        context.pop(0)
        build_context(message[:222])
    else:
        context.append(propulsion + message[:221])


# Generate a completion from bias and context
@to_thread
def gen(bias=None, ctx=None, failures=0):

    prompt = propulsion

    if ctx == None:
        ctx = context
    history = "\n".join(ctx) + "\n"

    max_new_tokens = config[focus].get("max_new_tokens", 111)

    # set quantum state
    # try:
    #     q = requests.get(
    #         "https://qrng.anu.edu.au/API/jsonI.php?length=6&type=uint8"
    #     ).json()
    #     if not q["data"][0] <= 256 and not q["data"][1] <= 256:
    #         raise Exception("Something failed while querying the quantum API.")
    # except Exception as e:
    #     print(e)
    #     q = {"data": [random.randint(0, 256), random.randint(0, 256)]}

    # seed = None
    # if q["data"][0] <= 32:
    #     seed = int(q["data"][0])
    #     print(
    #         bc.CORE
    #         + "INK@CORE "
    #         + ad.TEXT
    #         + ship
    #         + " quantum seed was set to "
    #         + str(seed)
    #     )

    # bias the prompt
    if bias is not None:
        if (len(str(bias)) == 18) or (len(str(bias)) == 19):
            prefixes = ["I", "You", ""]
            prompt = propulsion + str(bias) + ship + " " + random.choice(prefixes)

    eos = ai.tokenizer.convert_tokens_to_ids(ai.tokenizer.tokenize(propulsion)[0])

    # try to complete the prompt
    # https://huggingface.co/docs/transformers/main_classes/text_generation
    try:
        completion = ai.generate(
            n=1,
            prompt=history + prompt,
            do_sample=True,
            min_length=23,
            max_new_tokens=max_new_tokens,
            temperature=1.23,
            # top_k=40,
            # top_p=0.9,
            return_as_list=True,
            num_beams=3,
            repetition_penalty=1.4,
            exponential_decay_length_penalty=(42, 1.2),
            no_repeat_ngram_size=3,
            early_stopping=True,
            renormalize_logits=True,
            eos_token_id=eos,
            max_time=59,
            seed=random.randint(0, 2**32 - 1),
        )
    except Exception as e:
        return print(e)

    try:
        output = None
        generation = completion[0][len(history) :]
        group = re.search(r"^(¶{1})(\d{2,23})(?::\s?>\s*)(.*)", generation)
        variables = re.compile("(?:\({3})(\d+\s*\d*)(?:\){3})")
        broken_variables = re.compile("(\d*\s+\d*)")
        if (
            group is None
            or propulsion in group[3]
            or variables.match(group[3])
            or broken_variables.match(group[3])
        ):
            if failures >= 9:
                raise Exception("failed to generate a response 10 times in a row")
            failures = failures + 1
            print("bad format, regenerating " + str(failures) + " time(s)")
            time.sleep(5)
            output = asyncio.run(gen(bias, ctx, failures))

        if output is None:
            output = [group[2], group[3]]

    except Exception as e:
        print(e)
        error = "".join(random.choices(list(bullets), k=random.randint(42, 128)))
        output = ["[ERROR]", error]
    return output


bullets = {
    "⠠",
    "⠏",
    "⠲",
    "⠢",
    "⠐",
    "⠕",
    "⠥",
    "⠭",
    "⠞",
    "⠱",
    "⠟",
    "⠒",
    "⠇",
    "⠙",
    "⠮",
    "⠪",
    "⠑",
    "⠷",
    "⠿",
    "⠊",
    "⠂",
    "⠅",
    "⠡",
    "⠬",
    "⠝",
    "⠰",
    "⠽",
    "⠻",
    "⠧",
    "⠃",
    "⠼",
    "⠹",
    "⠌",
    "⠵",
    "⠄",
    "⠎",
    "⠫",
    "⠳",
    "⠯",
    "⠗",
    "⠉",
    "⠁",
    "⠛",
    "⠸",
    "⠋",
    "⠺",
    "⠔",
    "⠓",
    "⠜",
    "⠆",
    "⠍",
    " ",
    "\n",
}
