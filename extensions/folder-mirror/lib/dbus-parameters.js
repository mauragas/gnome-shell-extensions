export function unpackDbusParameters(parameters) {
    if (typeof parameters?.deepUnpack === 'function')
        return parameters.deepUnpack();

    if (typeof parameters?.recursiveUnpack === 'function')
        return parameters.recursiveUnpack();

    if (Array.isArray(parameters))
        return parameters;

    if (parameters === null || parameters === undefined)
        return [];

    return [parameters];
}
