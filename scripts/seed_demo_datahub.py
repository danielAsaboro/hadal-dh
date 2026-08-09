#!/usr/bin/env python3
"""Seed the controlled ChangeMarshal demo graph into DATAHUB_GMS_URL."""

from datahub.sdk.main_client import DataHubClient

from cutset.demo_seed import seed_demo


def main() -> None:
    urns = seed_demo(DataHubClient.from_env())
    print("Seeded ChangeMarshal demo graph:")
    for urn in urns:
        print(f"- {urn}")


if __name__ == "__main__":
    main()
