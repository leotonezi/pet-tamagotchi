/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pet_tamagotchi.json`.
 */
export type PetTamagotchi = {
  "address": "CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC",
  "metadata": {
    "name": "petTamagotchi",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Solana pet care game using PDAs"
  },
  "instructions": [
    {
      "name": "bathe",
      "discriminator": [
        64,
        173,
        10,
        148,
        203,
        210,
        41,
        95
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "pet"
          ]
        },
        {
          "name": "pet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "checkStatus",
      "discriminator": [
        52,
        123,
        249,
        8,
        93,
        159,
        87,
        227
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "pet"
          ]
        },
        {
          "name": "pet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "createPet",
      "discriminator": [
        31,
        116,
        155,
        96,
        251,
        101,
        128,
        164
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "pet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "species",
          "type": "string"
        },
        {
          "name": "birthDate",
          "type": "i64"
        }
      ]
    },
    {
      "name": "feed",
      "discriminator": [
        46,
        213,
        237,
        176,
        190,
        113,
        182,
        94
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "pet"
          ]
        },
        {
          "name": "pet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "play",
      "discriminator": [
        213,
        157,
        193,
        142,
        228,
        56,
        248,
        150
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "pet"
          ]
        },
        {
          "name": "pet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "sleep",
      "discriminator": [
        21,
        124,
        106,
        103,
        160,
        3,
        183,
        98
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "pet"
          ]
        },
        {
          "name": "pet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "walk",
      "discriminator": [
        117,
        227,
        10,
        68,
        128,
        250,
        50,
        154
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "pet"
          ]
        },
        {
          "name": "pet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "pet",
      "discriminator": [
        180,
        195,
        178,
        241,
        61,
        123,
        238,
        32
      ]
    }
  ],
  "events": [
    {
      "name": "petBathed",
      "discriminator": [
        158,
        104,
        243,
        245,
        248,
        160,
        62,
        27
      ]
    },
    {
      "name": "petCreated",
      "discriminator": [
        70,
        192,
        233,
        246,
        240,
        12,
        227,
        0
      ]
    },
    {
      "name": "petFed",
      "discriminator": [
        211,
        57,
        191,
        33,
        208,
        30,
        169,
        23
      ]
    },
    {
      "name": "petPlayed",
      "discriminator": [
        6,
        224,
        203,
        23,
        35,
        176,
        140,
        250
      ]
    },
    {
      "name": "petSlept",
      "discriminator": [
        62,
        0,
        18,
        166,
        214,
        182,
        153,
        75
      ]
    },
    {
      "name": "petWalked",
      "discriminator": [
        58,
        246,
        5,
        238,
        214,
        163,
        206,
        238
      ]
    },
    {
      "name": "statusChecked",
      "discriminator": [
        158,
        32,
        195,
        175,
        219,
        20,
        38,
        158
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "nameEmpty",
      "msg": "Pet name must not be empty"
    },
    {
      "code": 6001,
      "name": "nameTooLong",
      "msg": "Pet name exceeds 32 characters"
    },
    {
      "code": 6002,
      "name": "speciesTooLong",
      "msg": "Species exceeds 16 characters"
    },
    {
      "code": 6003,
      "name": "petDeceased",
      "msg": "This pet has passed away"
    },
    {
      "code": 6004,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6005,
      "name": "unauthorized",
      "msg": "Caller is not the pet owner"
    }
  ],
  "types": [
    {
      "name": "pet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "species",
            "type": "string"
          },
          {
            "name": "birthDate",
            "type": "i64"
          },
          {
            "name": "hunger",
            "type": "u8"
          },
          {
            "name": "tiredness",
            "type": "u8"
          },
          {
            "name": "hygiene",
            "type": "u8"
          },
          {
            "name": "happiness",
            "type": "u8"
          },
          {
            "name": "health",
            "type": "u8"
          },
          {
            "name": "needsMeal",
            "type": "bool"
          },
          {
            "name": "needsWalk",
            "type": "bool"
          },
          {
            "name": "needsBath",
            "type": "bool"
          },
          {
            "name": "isAlive",
            "type": "bool"
          },
          {
            "name": "lastInteraction",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "petBathed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pet",
            "type": "pubkey"
          },
          {
            "name": "hygiene",
            "type": "u8"
          },
          {
            "name": "happiness",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "petCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "species",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "petFed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pet",
            "type": "pubkey"
          },
          {
            "name": "hunger",
            "type": "u8"
          },
          {
            "name": "happiness",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "petPlayed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pet",
            "type": "pubkey"
          },
          {
            "name": "happiness",
            "type": "u8"
          },
          {
            "name": "tiredness",
            "type": "u8"
          },
          {
            "name": "hunger",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "petSlept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pet",
            "type": "pubkey"
          },
          {
            "name": "tiredness",
            "type": "u8"
          },
          {
            "name": "hunger",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "petWalked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pet",
            "type": "pubkey"
          },
          {
            "name": "happiness",
            "type": "u8"
          },
          {
            "name": "tiredness",
            "type": "u8"
          },
          {
            "name": "hygiene",
            "type": "u8"
          },
          {
            "name": "hunger",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "statusChecked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pet",
            "type": "pubkey"
          },
          {
            "name": "health",
            "type": "u8"
          },
          {
            "name": "isAlive",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
