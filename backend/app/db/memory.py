from collections import defaultdict


class MemoryDB:
    def __init__(self) -> None:
        self.accounts: dict[str, dict] = {}
        self.voices: dict[str, dict] = {}
        self.personas: dict[str, dict] = {}
        self.rule_sets: dict[str, dict] = {}
        self.workflows: dict[str, dict] = {}
        self.runs: dict[str, dict] = {}
        self.analytics: dict[str, float | int] = defaultdict(float)


db = MemoryDB()
