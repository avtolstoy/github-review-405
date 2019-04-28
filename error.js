/**
 * Copyright (c) Andrey Tolstoy <avtolstoy@gmail.com>
 * All rights reserved.
 *
 * This file is licensed under the BSD 2-Clause License, which accompanies this project
 * and is available under https://opensource.org/licenses/BSD-2-Clause.
 */

'use strict';

export class AppError extends Error {
    constructor (message, extra) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
        this.extra = extra;
    }
};
